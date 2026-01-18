"""
Custom styled dialog utilities for TLI Tracker.

Provides dark-themed dialogs matching the app's aesthetic.
"""

from enum import Enum
from typing import Optional

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QDialog,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QGraphicsDropShadowEffect,
)
from PySide6.QtGui import QPainter, QBrush, QColor, QPainterPath, QPen


class DialogResult(Enum):
    """Result of a dialog interaction."""
    OK = "ok"
    RETRY = "retry"
    CANCEL = "cancel"


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
            retry_btn = QPushButton("Retry")
            retry_btn.clicked.connect(self._on_retry)
            button_layout.addWidget(retry_btn)

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
