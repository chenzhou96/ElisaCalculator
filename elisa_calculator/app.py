import warnings

import tkinter as tk

from .gui.main_window import ElisaCalculatorApp

warnings.filterwarnings('ignore')


def main():
    root = tk.Tk()
    app = ElisaCalculatorApp(root)
    root.mainloop()
