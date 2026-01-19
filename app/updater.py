"""
Auto-update functionality for TLI Tracker.

Checks GitHub releases for updates and handles download/installation.
"""

import json
import os
import subprocess
import tempfile
from dataclasses import dataclass
from typing import Callable, Optional, Tuple
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

from .version import VERSION, GITHUB_OWNER, GITHUB_REPO


@dataclass
class UpdateInfo:
    """Information about an available update."""
    version: str
    download_url: str
    release_notes: str


class Updater:
    """Handles checking for and applying updates from GitHub releases."""

    GITHUB_API_URL = f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest"
    INSTALLER_NAME = "TLITracker_Setup.exe"

    def __init__(self):
        self._download_path: Optional[str] = None

    def check_for_update(self) -> Tuple[bool, Optional[UpdateInfo], Optional[str]]:
        """
        Check GitHub for a newer release.

        Returns:
            Tuple of (update_available, update_info, error_message)
            - If update available: (True, UpdateInfo, None)
            - If no update: (False, None, None)
            - If error: (False, None, error_message)
        """
        try:
            request = Request(
                self.GITHUB_API_URL,
                headers={"Accept": "application/vnd.github.v3+json"}
            )
            with urlopen(request, timeout=10) as response:
                data = json.loads(response.read().decode("utf-8"))

            # Extract version from tag (remove 'v' prefix if present)
            tag_name = data.get("tag_name", "")
            latest_version = tag_name.lstrip("v")

            if not self._is_newer_version(latest_version):
                return False, None, None

            # Find the installer asset
            download_url = None
            for asset in data.get("assets", []):
                if asset.get("name") == self.INSTALLER_NAME:
                    download_url = asset.get("browser_download_url")
                    break

            if not download_url:
                return False, None, f"Release found but no {self.INSTALLER_NAME} asset"

            # Get release notes
            release_notes = data.get("body", "No release notes available.")

            update_info = UpdateInfo(
                version=latest_version,
                download_url=download_url,
                release_notes=release_notes
            )

            return True, update_info, None

        except HTTPError as e:
            if e.code == 404:
                return False, None, "No releases found"
            return False, None, f"HTTP error: {e.code}"
        except URLError as e:
            return False, None, f"Network error: {e.reason}"
        except json.JSONDecodeError:
            return False, None, "Invalid response from GitHub"
        except Exception as e:
            return False, None, f"Unexpected error: {str(e)}"

    def download_update(
        self,
        info: UpdateInfo,
        progress_callback: Optional[Callable[[int, int], None]] = None
    ) -> Tuple[Optional[str], Optional[str]]:
        """
        Download the update installer to a temp directory.

        Args:
            info: UpdateInfo with download URL
            progress_callback: Optional callback(downloaded_bytes, total_bytes)

        Returns:
            Tuple of (download_path, error_message)
            - Success: (path_to_installer, None)
            - Error: (None, error_message)
        """
        try:
            request = Request(info.download_url)
            with urlopen(request, timeout=60) as response:
                total_size = int(response.headers.get("Content-Length", 0))

                # Create temp directory for download
                temp_dir = tempfile.mkdtemp(prefix="tli_update_")
                download_path = os.path.join(temp_dir, self.INSTALLER_NAME)

                downloaded = 0
                chunk_size = 8192

                with open(download_path, "wb") as f:
                    while True:
                        chunk = response.read(chunk_size)
                        if not chunk:
                            break
                        f.write(chunk)
                        downloaded += len(chunk)

                        if progress_callback and total_size > 0:
                            progress_callback(downloaded, total_size)

                self._download_path = download_path
                return download_path, None

        except HTTPError as e:
            return None, f"Download failed: HTTP {e.code}"
        except URLError as e:
            return None, f"Download failed: {e.reason}"
        except IOError as e:
            return None, f"Failed to save file: {str(e)}"
        except Exception as e:
            return None, f"Download error: {str(e)}"

    def launch_installer(self, path: str) -> Tuple[bool, Optional[str]]:
        """
        Launch the installer and signal the app to quit.

        Args:
            path: Path to the downloaded installer

        Returns:
            Tuple of (success, error_message)
        """
        try:
            if not os.path.exists(path):
                return False, "Installer file not found"

            # Launch installer detached from current process
            subprocess.Popen(
                [path],
                creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
                close_fds=True
            )

            return True, None

        except Exception as e:
            return False, f"Failed to launch installer: {str(e)}"

    def _is_newer_version(self, latest: str) -> bool:
        """
        Compare versions using semantic versioning.

        Args:
            latest: The latest version string (e.g., "1.2.3")

        Returns:
            True if latest is newer than current VERSION
        """
        try:
            current_parts = [int(x) for x in VERSION.split(".")]
            latest_parts = [int(x) for x in latest.split(".")]

            # Pad shorter version with zeros
            max_len = max(len(current_parts), len(latest_parts))
            current_parts.extend([0] * (max_len - len(current_parts)))
            latest_parts.extend([0] * (max_len - len(latest_parts)))

            return latest_parts > current_parts

        except (ValueError, AttributeError):
            # If parsing fails, assume no update
            return False

    @property
    def current_version(self) -> str:
        """Get the current application version."""
        return VERSION
