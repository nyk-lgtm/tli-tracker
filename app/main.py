"""
Main entry point for TLI Tracker.

Initializes the application using PySide6 + QWebEngineView.
"""

from app.qt_app import main
import ctypes

if __name__ == '__main__':
    try:
        myappid = 'tli.tracker.app.v1' 
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(myappid)
    except Exception:
        pass
    main()
