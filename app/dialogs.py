"""
Custom styled dialog utilities for TLI Tracker.

Provides dark-themed dialogs matching the app's aesthetic.
"""

from enum import Enum
from typing import Optional

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QDialog,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QGraphicsDropShadowEffect,
    QProgressBar,
    QTextEdit,
)
from PySide6.QtGui import QPainter, QBrush, QColor, QPainterPath, QPen


class DialogResult(Enum):
    """Result of a dialog interaction."""
    OK = "ok"
    RETRY = "retry"
    CANCEL = "cancel"
    EXIT = "exit"


# App color scheme
COLORS = {
    "bg": "#0f172a",
    "card": "#1e293b",
    "border": "#334155",
    "primary": "#6366f1",
    "danger": "#fb923c",
    "warning": "#f59e0b",
    "success": "#22d3ee",
    "text": "#f1f5f9",
    "text_muted": "#94a3b8",
}

STYLESHEET = f"""
    QDialog {{
        background-color: {COLORS['card']};
        border: 1px solid {COLORS['border']};
        border-radius: 12px;
    }}
    QLabel {{
        color: {COLORS['text']};
        background: transparent;
    }}
    QLabel#title {{
        font-size: 16px;
        font-weight: bold;
        color: {COLORS['text']};
    }}
    QLabel#message {{
        font-size: 13px;
        color: {COLORS['text']};
    }}
    QLabel#detail {{
        font-size: 12px;
        color: {COLORS['text_muted']};
    }}
    QLabel#icon {{
        font-size: 28px;
    }}
    QPushButton {{
        padding: 8px 20px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        border: 1px solid {COLORS['border']};
        background-color: {COLORS['bg']};
        color: {COLORS['text']};
    }}
    QPushButton:hover {{
        border-color: {COLORS['primary']};
        background-color: {COLORS['border']};
    }}
    QPushButton#primary {{
        background-color: {COLORS['primary']};
        border-color: {COLORS['primary']};
        color: white;
    }}
    QPushButton#primary:hover {{
        background-color: #5558e3;
    }}
"""


class StyledDialog(QDialog):
    """Custom styled dialog matching the app's dark theme."""

    def __init__(
        self,
        title: str,
        message: str,
        detail: Optional[str] = None,
        icon: str = "",
        show_retry: bool = False,
        parent=None,
    ):
        super().__init__(parent)
        self.result_action = DialogResult.OK

        self.setWindowTitle(title)
        self.setFixedWidth(450)  # Extra width for shadow margins
        self.setWindowFlags(
            Qt.WindowType.Dialog |
            Qt.WindowType.FramelessWindowHint
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setStyleSheet(STYLESHEET)

        # Add drop shadow for depth
        shadow = QGraphicsDropShadowEffect(self)
        shadow.setBlurRadius(40)
        shadow.setColor(QColor(0, 0, 0, 180))
        shadow.setOffset(0, 8)
        self.setGraphicsEffect(shadow)

        # Extra margin to accommodate shadow
        layout = QVBoxLayout(self)
        layout.setContentsMargins(40, 40, 40, 48)
        layout.setSpacing(16)

        # Header with icon and title
        header = QHBoxLayout()
        header.setSpacing(12)

        if icon:
            icon_label = QLabel(icon)
            icon_label.setObjectName("icon")
            header.addWidget(icon_label)

        title_label = QLabel(title)
        title_label.setObjectName("title")
        header.addWidget(title_label)
        header.addStretch()

        layout.addLayout(header)

        # Message
        message_label = QLabel(message)
        message_label.setObjectName("message")
        message_label.setWordWrap(True)
        layout.addWidget(message_label)

        # Detail (optional)
        if detail:
            detail_label = QLabel(detail)
            detail_label.setObjectName("detail")
            detail_label.setWordWrap(True)
            layout.addWidget(detail_label)

        layout.addSpacing(8)

        # Buttons
        button_layout = QHBoxLayout()
        button_layout.setSpacing(12)
        button_layout.addStretch()

        if show_retry:
            # Exit as secondary, Retry as primary
            exit_btn = QPushButton("Exit")
            exit_btn.clicked.connect(self._on_exit)
            button_layout.addWidget(exit_btn)

            retry_btn = QPushButton("Retry")
            retry_btn.setObjectName("primary")
            retry_btn.clicked.connect(self._on_retry)
            retry_btn.setDefault(True)
            button_layout.addWidget(retry_btn)
        else:
            ok_btn = QPushButton("OK")
            ok_btn.setObjectName("primary")
            ok_btn.clicked.connect(self._on_ok)
            ok_btn.setDefault(True)
            button_layout.addWidget(ok_btn)

        layout.addLayout(button_layout)

    def _on_ok(self):
        self.result_action = DialogResult.OK
        self.accept()

    def _on_retry(self):
        self.result_action = DialogResult.RETRY
        self.accept()

    def _on_exit(self):
        self.result_action = DialogResult.EXIT
        self.accept()

    def mousePressEvent(self, event):
        """Allow dragging the dialog."""
        if event.button() == Qt.MouseButton.LeftButton:
            self._drag_pos = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        """Handle dialog dragging."""
        if event.buttons() == Qt.MouseButton.LeftButton and hasattr(self, '_drag_pos'):
            self.move(event.globalPosition().toPoint() - self._drag_pos)
            event.accept()

    def paintEvent(self, event):
        """Paint the rounded rectangle background with shadow margin."""
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        # Account for shadow margins
        margin = 24
        rect_x = margin
        rect_y = margin
        rect_w = self.width() - (margin * 2)
        rect_h = self.height() - (margin * 2) - 8  # Extra for shadow offset

        # Draw background
        path = QPainterPath()
        path.addRoundedRect(rect_x, rect_y, rect_w, rect_h, 12, 12)

        painter.fillPath(path, QBrush(QColor(COLORS["card"])))

        # Draw accent border (primary color, subtle glow effect)
        painter.setPen(QPen(QColor(COLORS["primary"]), 1.5))
        painter.drawPath(path)


def show_error(
    title: str,
    message: str,
    detail: str = None,
    show_retry: bool = False,
) -> DialogResult:
    """
    Show a styled error dialog.

    Args:
        title: Dialog window title
        message: Main error message (brief)
        detail: Optional detailed explanation
        show_retry: Whether to show a Retry button

    Returns:
        DialogResult.OK or DialogResult.RETRY
    """
    dialog = StyledDialog(
        title=title,
        message=message,
        detail=detail,
        icon="",
        show_retry=show_retry,
    )
    dialog.exec()
    return dialog.result_action


def show_warning(title: str, message: str, detail: str = None) -> DialogResult:
    """
    Show a styled warning dialog.

    Args:
        title: Dialog window title
        message: Main warning message
        detail: Optional detailed explanation

    Returns:
        DialogResult.OK
    """
    dialog = StyledDialog(
        title=title,
        message=message,
        detail=detail,
        icon="",
    )
    dialog.exec()
    return dialog.result_action


def show_info(title: str, message: str) -> DialogResult:
    """
    Show a styled informational dialog.

    Args:
        title: Dialog window title
        message: Information to display

    Returns:
        DialogResult.OK
    """
    dialog = StyledDialog(
        title=title,
        message=message,
        icon="",
    )
    dialog.exec()
    return dialog.result_action


class UpdateAvailableDialog(QDialog):
    """Dialog showing update availability with version info and release notes."""

    def __init__(
        self,
        current_version: str,
        new_version: str,
        release_notes: str,
        parent=None,
    ):
        super().__init__(parent)
        self.result_action = DialogResult.CANCEL

        self.setWindowTitle("Update Available")
        self.setFixedWidth(500)
        self.setWindowFlags(
            Qt.WindowType.Dialog |
            Qt.WindowType.FramelessWindowHint
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setStyleSheet(STYLESHEET)

        shadow = QGraphicsDropShadowEffect(self)
        shadow.setBlurRadius(40)
        shadow.setColor(QColor(0, 0, 0, 180))
        shadow.setOffset(0, 8)
        self.setGraphicsEffect(shadow)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(40, 40, 40, 48)
        layout.setSpacing(16)

        # Header
        header = QHBoxLayout()
        header.setSpacing(12)

        icon_label = QLabel("")
        icon_label.setObjectName("icon")
        header.addWidget(icon_label)

        title_label = QLabel("Update Available")
        title_label.setObjectName("title")
        header.addWidget(title_label)
        header.addStretch()

        layout.addLayout(header)

        # Version info
        version_text = f"A new version of TLI Tracker is available!\n\nCurrent: v{current_version}  →  New: v{new_version}"
        version_label = QLabel(version_text)
        version_label.setObjectName("message")
        version_label.setWordWrap(True)
        layout.addWidget(version_label)

        # Release notes (scrollable text area)
        notes_label = QLabel("Release Notes:")
        notes_label.setObjectName("detail")
        layout.addWidget(notes_label)

        notes_text = QTextEdit()
        notes_text.setReadOnly(True)
        notes_text.setPlainText(release_notes)
        notes_text.setMaximumHeight(120)
        notes_text.setStyleSheet(f"""
            QTextEdit {{
                background-color: {COLORS['bg']};
                border: 1px solid {COLORS['border']};
                border-radius: 8px;
                color: {COLORS['text_muted']};
                padding: 8px;
                font-size: 12px;
            }}
        """)
        layout.addWidget(notes_text)

        layout.addSpacing(8)

        # Buttons
        button_layout = QHBoxLayout()
        button_layout.setSpacing(12)
        button_layout.addStretch()

        later_btn = QPushButton("Later")
        later_btn.clicked.connect(self._on_later)
        button_layout.addWidget(later_btn)

        update_btn = QPushButton("Update Now")
        update_btn.setObjectName("primary")
        update_btn.clicked.connect(self._on_update)
        update_btn.setDefault(True)
        button_layout.addWidget(update_btn)

        layout.addLayout(button_layout)

    def _on_later(self):
        self.result_action = DialogResult.CANCEL
        self.reject()

    def _on_update(self):
        self.result_action = DialogResult.OK
        self.accept()

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self._drag_pos = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        if event.buttons() == Qt.MouseButton.LeftButton and hasattr(self, '_drag_pos'):
            self.move(event.globalPosition().toPoint() - self._drag_pos)
            event.accept()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        margin = 24
        rect_x = margin
        rect_y = margin
        rect_w = self.width() - (margin * 2)
        rect_h = self.height() - (margin * 2) - 8

        path = QPainterPath()
        path.addRoundedRect(rect_x, rect_y, rect_w, rect_h, 12, 12)

        painter.fillPath(path, QBrush(QColor(COLORS["card"])))
        painter.setPen(QPen(QColor(COLORS["primary"]), 1.5))
        painter.drawPath(path)


class DownloadProgressDialog(QDialog):
    """Dialog showing download progress with cancel option."""

    cancelled = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._cancelled = False

        self.setWindowTitle("Downloading Update")
        self.setFixedWidth(450)
        self.setWindowFlags(
            Qt.WindowType.Dialog |
            Qt.WindowType.FramelessWindowHint
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setStyleSheet(STYLESHEET)

        shadow = QGraphicsDropShadowEffect(self)
        shadow.setBlurRadius(40)
        shadow.setColor(QColor(0, 0, 0, 180))
        shadow.setOffset(0, 8)
        self.setGraphicsEffect(shadow)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(40, 40, 40, 48)
        layout.setSpacing(16)

        # Header
        header = QHBoxLayout()
        header.setSpacing(12)

        icon_label = QLabel("")
        icon_label.setObjectName("icon")
        header.addWidget(icon_label)

        title_label = QLabel("Downloading Update")
        title_label.setObjectName("title")
        header.addWidget(title_label)
        header.addStretch()

        layout.addLayout(header)

        # Status message
        self.status_label = QLabel("Downloading...")
        self.status_label.setObjectName("message")
        layout.addWidget(self.status_label)

        # Progress bar
        self.progress_bar = QProgressBar()
        self.progress_bar.setMinimum(0)
        self.progress_bar.setMaximum(100)
        self.progress_bar.setValue(0)
        self.progress_bar.setStyleSheet(f"""
            QProgressBar {{
                background-color: {COLORS['bg']};
                border: 1px solid {COLORS['border']};
                border-radius: 8px;
                height: 20px;
                text-align: center;
                color: {COLORS['text']};
            }}
            QProgressBar::chunk {{
                background-color: {COLORS['primary']};
                border-radius: 7px;
            }}
        """)
        layout.addWidget(self.progress_bar)

        # Progress text
        self.progress_label = QLabel("0%")
        self.progress_label.setObjectName("detail")
        self.progress_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self.progress_label)

        layout.addSpacing(8)

        # Cancel button
        button_layout = QHBoxLayout()
        button_layout.addStretch()

        self.cancel_btn = QPushButton("Cancel")
        self.cancel_btn.clicked.connect(self._on_cancel)
        button_layout.addWidget(self.cancel_btn)

        layout.addLayout(button_layout)

    def set_progress(self, downloaded: int, total: int):
        """Update the progress bar and text."""
        if total > 0:
            percent = int((downloaded / total) * 100)
            self.progress_bar.setValue(percent)

            # Format sizes
            downloaded_mb = downloaded / (1024 * 1024)
            total_mb = total / (1024 * 1024)
            self.progress_label.setText(f"{downloaded_mb:.1f} MB / {total_mb:.1f} MB ({percent}%)")
        else:
            self.progress_label.setText(f"{downloaded / 1024:.0f} KB downloaded")

    def set_status(self, status: str):
        """Update the status message."""
        self.status_label.setText(status)

    def is_cancelled(self) -> bool:
        """Check if download was cancelled."""
        return self._cancelled

    def _on_cancel(self):
        self._cancelled = True
        self.cancelled.emit()
        self.reject()

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self._drag_pos = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        if event.buttons() == Qt.MouseButton.LeftButton and hasattr(self, '_drag_pos'):
            self.move(event.globalPosition().toPoint() - self._drag_pos)
            event.accept()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        margin = 24
        rect_x = margin
        rect_y = margin
        rect_w = self.width() - (margin * 2)
        rect_h = self.height() - (margin * 2) - 8

        path = QPainterPath()
        path.addRoundedRect(rect_x, rect_y, rect_w, rect_h, 12, 12)

        painter.fillPath(path, QBrush(QColor(COLORS["card"])))
        painter.setPen(QPen(QColor(COLORS["primary"]), 1.5))
        painter.drawPath(path)


def show_update_available(
    current_version: str,
    new_version: str,
    release_notes: str,
) -> bool:
    """
    Show the update available dialog.

    Returns:
        True if user wants to update, False otherwise
    """
    dialog = UpdateAvailableDialog(
        current_version=current_version,
        new_version=new_version,
        release_notes=release_notes,
    )
    dialog.exec()
    return dialog.result_action == DialogResult.OK
