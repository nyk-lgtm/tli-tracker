"""
Stateful auto-update manager for TLI Tracker.

Checks GitHub releases, downloads installers in the background, and applies
updates with a restart-to-update flow.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from PySide6.QtCore import QObject, QUrl
from PySide6.QtNetwork import QNetworkAccessManager, QNetworkReply, QNetworkRequest

from .storage import load_config
from .version import GITHUB_OWNER, GITHUB_REPO, VERSION


@dataclass
class UpdateInfo:
    """Information about an available update."""

    version: str
    download_url: str
    release_notes: str


class Updater(QObject):
    """Manage update checks, background downloads, and installer launch."""

    GITHUB_API_URL = (
        f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest"
    )
    INSTALLER_NAME = "TLITracker_Setup.exe"
    SILENT_INSTALL_ARGS = ("/VERYSILENT", "/SUPPRESSMSGBOXES", "/SP-", "/NORESTART")
    BUSY_STATES = {"checking", "downloading"}
    TERMINAL_PENDING_STATE = "downloaded"

    def __init__(
        self,
        on_state_change: Callable[[dict], None] | None = None,
        parent: QObject | None = None,
    ):
        super().__init__(parent)
        self._on_state_change = on_state_change
        self._network_manager: QNetworkAccessManager | None = None
        self._check_reply: QNetworkReply | None = None
        self._download_reply: QNetworkReply | None = None
        self._download_file = None
        self._download_dir: Path | None = None
        self._download_path: Path | None = None
        self._applying_update = False
        self._pending_update: UpdateInfo | None = None
        self._state = self._build_state()

    def get_update_state(self) -> dict:
        """Return the current updater snapshot."""
        return dict(self._state)

    def start_update_flow(self, trigger: str) -> dict:
        """
        Start a check/download cycle.

        Busy and downloaded states are deduplicated by returning the current
        snapshot without issuing new network requests.
        """
        if trigger not in {"startup", "manual"}:
            trigger = "manual"

        if trigger == "startup" and not load_config().get(
            "auto_download_updates", True
        ):
            return self.get_update_state()

        status = self._state["status"]
        if status in self.BUSY_STATES or status == self.TERMINAL_PENDING_STATE:
            return self.get_update_state()

        self._clear_download_artifacts()
        self._pending_update = None
        self._set_state(
            status="checking",
            trigger=trigger,
            new_version="",
            progress_percent=0,
            error="",
        )
        self._start_check_request()
        return self.get_update_state()

    def apply_downloaded_update(self) -> dict:
        """Launch the cached installer in silent mode."""
        if self._applying_update:
            return {"status": "error", "error": "Update is already being applied"}

        if self._state["status"] != self.TERMINAL_PENDING_STATE:
            return {"status": "error", "error": "No downloaded update is ready"}

        if not self._download_path or not self._download_path.exists():
            self._set_error("Downloaded installer is missing")
            return {"status": "error", "error": "Downloaded installer is missing"}

        try:
            self._applying_update = True
            subprocess.Popen(
                [
                    str(self._download_path),
                    *self.SILENT_INSTALL_ARGS,
                ],
                creationflags=subprocess.DETACHED_PROCESS
                | subprocess.CREATE_NEW_PROCESS_GROUP,
                close_fds=True,
            )
            return {"status": "ok"}
        except Exception as exc:
            self._applying_update = False
            message = f"Failed to launch installer: {exc}"
            self._set_error(message)
            return {"status": "error", "error": message}

    def _build_state(self, **overrides) -> dict:
        state = {
            "status": "idle",
            "current_version": VERSION,
            "new_version": "",
            "progress_percent": 0,
            "error": "",
            "trigger": "",
            "last_checked_at": "",
            "release_notes": "",
        }
        state.update(overrides)
        return state

    def _emit_state(self) -> None:
        if self._on_state_change:
            self._on_state_change(self.get_update_state())

    def _set_state(self, **updates) -> None:
        next_state = self._build_state(**self._state)
        next_state.update(updates)
        self._state = next_state
        self._emit_state()

    def _set_error(self, message: str) -> None:
        self._pending_update = None
        self._set_state(
            status="error", progress_percent=0, error=message, release_notes=""
        )

    def _ensure_network_manager(self) -> QNetworkAccessManager:
        if self._network_manager is None:
            self._network_manager = QNetworkAccessManager(self)
        return self._network_manager

    def _build_request(self, url: str) -> QNetworkRequest:
        request = QNetworkRequest(QUrl(url))
        request.setRawHeader(b"Accept", b"application/vnd.github.v3+json")
        request.setHeader(QNetworkRequest.KnownHeaders.UserAgentHeader, "TLITracker")
        return request

    def _start_check_request(self) -> None:
        request = self._build_request(self.GITHUB_API_URL)
        reply = self._ensure_network_manager().get(request)
        self._check_reply = reply
        reply.finished.connect(lambda: self._on_check_finished(reply))

    def _on_check_finished(self, reply: QNetworkReply) -> None:
        if self._check_reply is reply:
            self._check_reply = None

        self._state["last_checked_at"] = datetime.now(timezone.utc).isoformat()

        try:
            if reply.error() != QNetworkReply.NetworkError.NoError:
                self._set_error(f"Update check failed: {reply.errorString()}")
                return

            payload = bytes(reply.readAll()).decode("utf-8")
            try:
                data = json.loads(payload)
            except json.JSONDecodeError:
                self._set_error("Update check failed: invalid response from GitHub")
                return

            tag_name = str(data.get("tag_name", ""))
            latest_version = tag_name.lstrip("v")

            if not self._is_newer_version(latest_version):
                self._pending_update = None
                self._set_state(
                    status="up_to_date",
                    new_version="",
                    progress_percent=0,
                    error="",
                    release_notes="",
                )
                return

            download_url = ""
            for asset in data.get("assets", []):
                if asset.get("name") == self.INSTALLER_NAME:
                    download_url = str(asset.get("browser_download_url", ""))
                    break

            if not download_url:
                self._set_error(f"Release found but no {self.INSTALLER_NAME} asset")
                return

            self._pending_update = UpdateInfo(
                version=latest_version,
                download_url=download_url,
                release_notes=str(data.get("body", "")),
            )
            self._set_state(
                status="downloading",
                new_version=latest_version,
                progress_percent=0,
                error="",
                release_notes=self._pending_update.release_notes,
            )
            self._start_download_request(self._pending_update)
        finally:
            reply.deleteLater()

    def _start_download_request(self, info: UpdateInfo) -> None:
        self._clear_download_artifacts()
        self._download_dir = Path(tempfile.mkdtemp(prefix="tli_update_"))
        self._download_path = self._download_dir / self.INSTALLER_NAME
        self._download_file = open(self._download_path, "wb")

        request = self._build_request(info.download_url)
        reply = self._ensure_network_manager().get(request)
        self._download_reply = reply
        reply.readyRead.connect(lambda: self._on_download_ready_read(reply))
        reply.downloadProgress.connect(self._on_download_progress)
        reply.finished.connect(lambda: self._on_download_finished(reply))

    def _on_download_ready_read(self, reply: QNetworkReply) -> None:
        if not self._download_file:
            return
        chunk = bytes(reply.readAll())
        if chunk:
            self._download_file.write(chunk)

    def _on_download_progress(self, downloaded_bytes: int, total_bytes: int) -> None:
        if self._state["status"] != "downloading":
            return
        if total_bytes <= 0:
            return
        progress = int((downloaded_bytes * 100) / total_bytes)
        progress = max(0, min(progress, 100))
        if progress != self._state.get("progress_percent"):
            self._set_state(progress_percent=progress)

    def _on_download_finished(self, reply: QNetworkReply) -> None:
        if self._download_reply is reply:
            self._download_reply = None

        try:
            self._on_download_ready_read(reply)
            if self._download_file:
                self._download_file.close()
                self._download_file = None

            if reply.error() != QNetworkReply.NetworkError.NoError:
                self._clear_download_artifacts()
                self._set_error(f"Download failed: {reply.errorString()}")
                return

            if not self._download_path or not self._download_path.exists():
                self._set_error("Download failed: installer was not saved")
                return

            self._set_state(
                status="downloaded",
                progress_percent=100,
                error="",
            )
        finally:
            reply.deleteLater()

    def _clear_download_artifacts(self) -> None:
        if self._download_reply is not None:
            self._download_reply.abort()
            self._download_reply.deleteLater()
            self._download_reply = None

        if self._download_file:
            self._download_file.close()
            self._download_file = None

        if self._download_dir and self._download_dir.exists():
            shutil.rmtree(self._download_dir, ignore_errors=True)

        self._download_dir = None
        self._download_path = None

    def _is_newer_version(self, latest: str) -> bool:
        """Compare versions using semantic versioning."""
        try:
            current_parts = [int(x) for x in VERSION.split(".")]
            latest_parts = [int(x) for x in latest.split(".")]

            max_len = max(len(current_parts), len(latest_parts))
            current_parts.extend([0] * (max_len - len(current_parts)))
            latest_parts.extend([0] * (max_len - len(latest_parts)))

            return latest_parts > current_parts
        except (ValueError, AttributeError):
            return False

    @property
    def current_version(self) -> str:
        """Get the current application version."""
        return VERSION
