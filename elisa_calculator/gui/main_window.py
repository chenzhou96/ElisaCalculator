import os
import sys
import threading
import traceback

import numpy as np

import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext, ttk

try:
    import pyperclip
except Exception:
    pyperclip = None

from ..common import resource_path
from ..io.readers import preview_dataframe_text, read_text_file_with_fallbacks
from ..io.writers import format_results_table
from ..services.workflow import run_calculation_workflow
from ..visualization.fonts import MATPLOTLIB_FONT_NAME, MATPLOTLIB_FONT_SOURCE


class ElisaCalculatorApp:
    def __init__(self, root):
        self.root = root
        self.colors = {
            'bg': '#F3F6FB',
            'panel': '#FFFFFF',
            'hero': '#0F172A',
            'text': '#0F172A',
            'subtext': '#475569',
            'muted': '#64748B',
            'border': '#D8E2F0',
            'accent': '#2563EB',
            'accent_hover': '#1D4ED8',
            'soft': '#EAF2FF',
            'success': '#0F766E',
            'warning': '#B45309',
            'log_bg': '#FBFDFF',
        }
        self.file_var = tk.StringVar()
        self.status_var = tk.StringVar(value='就绪')
        self.last_output_dir = None
        self._build_root()
        self._build_styles()
        self._build_ui()

    def _build_root(self):
        self.root.title('ELISA Calculator')
        self.root.geometry('1240x860')
        self.root.minsize(1080, 720)
        self.root.configure(bg=self.colors['bg'])
        try:
            icon_path = resource_path('Ab.ico')
            if os.path.exists(icon_path):
                self.root.iconbitmap(icon_path)
        except Exception:
            pass

    def _build_styles(self):
        style = ttk.Style()
        try:
            style.theme_use('clam')
        except Exception:
            pass

        style.configure('App.TFrame', background=self.colors['bg'])
        style.configure('Title.TLabel', background=self.colors['panel'], foreground=self.colors['text'], font=('Segoe UI', 13, 'bold'))
        style.configure('Body.TLabel', background=self.colors['panel'], foreground=self.colors['subtext'], font=('Segoe UI', 10))
        style.configure('Muted.TLabel', background=self.colors['panel'], foreground=self.colors['muted'], font=('Segoe UI', 9))
        style.configure('Accent.TButton', font=('Segoe UI', 10, 'bold'), padding=(14, 10), foreground='white', background=self.colors['accent'], borderwidth=0)
        style.map('Accent.TButton', background=[('active', self.colors['accent_hover']), ('pressed', self.colors['accent_hover'])])
        style.configure('Soft.TButton', font=('Segoe UI', 10), padding=(12, 9), foreground=self.colors['text'], background=self.colors['soft'], borderwidth=0)
        style.map('Soft.TButton', background=[('active', '#DCEAFF')])
        style.configure('Modern.TEntry', padding=8)
        style.configure('Modern.TNotebook', background=self.colors['bg'], borderwidth=0, tabmargins=(0, 0, 0, 0))
        style.configure('Modern.TNotebook.Tab', padding=(18, 10), font=('Segoe UI', 10, 'bold'))
        style.map('Modern.TNotebook.Tab', background=[('selected', self.colors['panel']), ('active', '#EEF4FF')])

    def _make_card(self, parent, padding=16):
        outer = tk.Frame(parent, bg=self.colors['bg'])
        card = tk.Frame(
            outer,
            bg=self.colors['panel'],
            highlightthickness=1,
            highlightbackground=self.colors['border'],
            bd=0
        )
        card.pack(fill='both', expand=True)
        inner = tk.Frame(card, bg=self.colors['panel'], padx=padding, pady=padding)
        inner.pack(fill='both', expand=True)
        return outer, inner

    def _make_textbox(self, parent, height=10, font=('Consolas', 10)):
        wrapper = tk.Frame(parent, bg=self.colors['panel'], highlightthickness=1, highlightbackground=self.colors['border'])
        text = scrolledtext.ScrolledText(
            wrapper,
            wrap=tk.NONE,
            height=height,
            font=font,
            relief='flat',
            bd=0,
            highlightthickness=0,
            bg=self.colors['log_bg'],
            fg=self.colors['text'],
            insertbackground=self.colors['text'],
            padx=10,
            pady=10
        )
        text.pack(fill='both', expand=True)
        return wrapper, text

    def _build_ui(self):
        main = ttk.Frame(self.root, style='App.TFrame', padding=18)
        main.pack(fill='both', expand=True)

        hero = tk.Frame(main, bg=self.colors['hero'], padx=24, pady=22)
        hero.pack(fill='x', pady=(0, 14))
        tk.Label(
            hero,
            text='ELISA 4PL Global Fit Studio',
            bg=self.colors['hero'], fg='white',
            font=('Segoe UI', 22, 'bold')
        ).pack(anchor='w')
        tk.Label(
            hero,
            text='EC50 自动计算系统',
            bg=self.colors['hero'], fg='#CBD5E1',
            font=('Segoe UI', 10)
        ).pack(anchor='w', pady=(6, 0))

        content = tk.Frame(main, bg=self.colors['bg'])
        content.pack(fill='both', expand=True)

        paned = tk.PanedWindow(content, orient=tk.HORIZONTAL, sashwidth=6, bg=self.colors['bg'], bd=0, relief='flat', showhandle=False)
        paned.pack(fill='both', expand=True)

        left = tk.Frame(paned, bg=self.colors['bg'])
        right = tk.Frame(paned, bg=self.colors['bg'])
        paned.add(left, minsize=620, stretch='always')
        paned.add(right, minsize=320)

        notebook_wrap, notebook_inner = self._make_card(left, padding=0)
        notebook_wrap.pack(fill='x', expand=False, pady=(0, 14))

        notebook = ttk.Notebook(notebook_inner, style='Modern.TNotebook', height=295)
        notebook.pack(fill='x', expand=False)
        self.notebook = notebook

        file_tab = tk.Frame(notebook, bg=self.colors['panel'])
        paste_tab = tk.Frame(notebook, bg=self.colors['panel'])
        notebook.add(file_tab, text='文件导入')
        notebook.add(paste_tab, text='直接粘贴')

        file_inner = tk.Frame(file_tab, bg=self.colors['panel'], padx=18, pady=18)
        file_inner.pack(fill='x', anchor='n')
        ttk.Label(file_inner, text='从 CSV / 文本文件导入', style='Title.TLabel').pack(anchor='w')
        ttk.Label(
            file_inner,
            text='支持 utf-8 / gbk / gb18030 等常见编码, 程序会自动识别是否存在表头',
            style='Body.TLabel', wraplength=620
        ).pack(anchor='w', pady=(6, 14))

        row = tk.Frame(file_inner, bg=self.colors['panel'])
        row.pack(fill='x')
        self.file_entry = ttk.Entry(row, textvariable=self.file_var, style='Modern.TEntry')
        self.file_entry.pack(side='left', fill='x', expand=True)
        ttk.Button(row, text='浏览文件', style='Soft.TButton', command=self.select_file).pack(side='left', padx=(10, 0))

        hint_box = tk.Frame(file_inner, bg='#F8FBFF', highlightthickness=1, highlightbackground=self.colors['border'])
        hint_box.pack(fill='x', pady=(12, 0))
        tk.Label(
            hint_box,
            text='格式要求: 第一列为浓度, 后续每列为一个组, 兼容无表头数据',
            bg='#F8FBFF', fg=self.colors['muted'], font=('Segoe UI', 9), justify='left', wraplength=640, padx=12, pady=10
        ).pack(anchor='w')

        paste_inner = tk.Frame(paste_tab, bg=self.colors['panel'], padx=18, pady=18)
        paste_inner.pack(fill='both', expand=True)
        ttk.Label(paste_inner, text='粘贴 Excel / 文本数据', style='Title.TLabel').pack(anchor='w')
        ttk.Label(
            paste_inner,
            text='支持逗号, Tab, 或空格分隔, 若首列全部为数字, 则按无表头数据处理, 并使用默认列名',
            style='Body.TLabel', wraplength=640
        ).pack(anchor='w', pady=(6, 12))

        paste_box_wrap, self.text_paste_input = self._make_textbox(paste_inner, height=11, font=('Consolas', 10))
        paste_box_wrap.pack(fill='both', expand=True)

        paste_btn_row = tk.Frame(paste_inner, bg=self.colors['panel'])
        paste_btn_row.pack(fill='x', pady=(10, 0))
        ttk.Button(paste_btn_row, text='从剪贴板粘贴', style='Soft.TButton', command=self.paste_from_clipboard).pack(side='left')
        ttk.Button(paste_btn_row, text='清空粘贴区', style='Soft.TButton', command=self.clear_paste).pack(side='left', padx=(8, 0))

        notebook.select(paste_tab)

        action_wrap, action_inner = self._make_card(left, padding=16)
        action_wrap.pack(fill='both', expand=True)
        top_action = tk.Frame(action_inner, bg=self.colors['panel'])
        top_action.pack(fill='x')
        tk.Label(top_action, text='执行与状态', bg=self.colors['panel'], fg=self.colors['text'], font=('Segoe UI', 12, 'bold')).pack(side='left')
        tk.Label(top_action, textvariable=self.status_var, bg=self.colors['panel'], fg=self.colors['success'], font=('Segoe UI', 10, 'bold')).pack(side='right')

        tk.Label(
            action_inner,
            text='计算完成后会自动输出: EC50_Summary.csv, 每组拟合曲线图, 以及所有组总览图',
            bg=self.colors['panel'], fg=self.colors['subtext'], font=('Segoe UI', 10), wraplength=760, justify='left'
        ).pack(anchor='w', pady=(6, 12))

        primary_btn_row = tk.Frame(action_inner, bg=self.colors['panel'])
        primary_btn_row.pack(fill='x', pady=(2, 0))
        self.btn_calculate = ttk.Button(
            primary_btn_row,
            text='开始计算',
            style='Accent.TButton',
            command=self.start_unified_calculation
        )
        self.btn_calculate.pack(fill='x')

        btn_row = tk.Frame(action_inner, bg=self.colors['panel'])
        btn_row.pack(fill='x', pady=(10, 0))
        ttk.Button(btn_row, text='清空当前输入', style='Soft.TButton', command=self.clear_current_input).pack(side='left')
        ttk.Button(btn_row, text='复制输出日志', style='Soft.TButton', command=self.copy_output_to_clipboard).pack(side='left', padx=(10, 0))
        self.btn_open_output = ttk.Button(btn_row, text='打开输出目录', style='Soft.TButton', command=self.open_output_dir)
        self.btn_open_output.pack(side='left', padx=(10, 0))
        ttk.Button(btn_row, text='清空输出日志', style='Soft.TButton', command=self.clear_output).pack(side='left', padx=(10, 0))

        note_spacer = tk.Frame(action_inner, bg=self.colors['panel'])
        note_spacer.pack(fill='both', expand=True)

        note_row = tk.Frame(action_inner, bg=self.colors['panel'])
        note_row.pack(fill='x', pady=(10, 0))
        tk.Label(
            note_row,
            text='提示: 运行过程中请勿关闭程序, 否则可能会导致数据丢失',
            bg=self.colors['panel'], fg=self.colors['muted'], font=('Segoe UI', 9), justify='left'
        ).pack(side='left', anchor='w')

        result_wrap, result_inner = self._make_card(right, padding=16)
        result_wrap.pack(fill='both', expand=True)
        head = tk.Frame(result_inner, bg=self.colors['panel'])
        head.pack(fill='x')
        ttk.Label(head, text='运行日志与结果汇总', style='Title.TLabel').pack(side='left')
        tk.Label(
            head,
            text='',
            bg=self.colors['panel'], fg=self.colors['success'], font=('Segoe UI', 9, 'bold')
        ).pack(side='right')

        ttk.Label(
            result_inner,
            text='这里显示计算过程和输出数据的文本摘要',
            style='Body.TLabel', wraplength=340
        ).pack(anchor='w', pady=(6, 12))

        output_wrap, self.text_output = self._make_textbox(result_inner, height=30, font=('Consolas', 10))
        output_wrap.pack(fill='both', expand=True)

        footer = tk.Label(
            main,
            text='Version 1.1 for XMJ, GCY, LH, LSZ',
            bg=self.colors['bg'], fg=self.colors['muted'], font=('Segoe UI', 9)
        )
        footer.pack(anchor='w', pady=(10, 0))

    def append_output(self, text):
        self.text_output.insert(tk.END, text)
        self.text_output.see(tk.END)

    def clear_output(self):
        self.text_output.delete('1.0', tk.END)

    def clear_paste(self):
        self.text_paste_input.delete('1.0', tk.END)

    def clear_file(self):
        self.file_var.set('')

    def clear_current_input(self):
        current = self.notebook.index(self.notebook.select())
        if current == 0:
            self.clear_file()
        else:
            self.clear_paste()

    def open_output_dir(self):
        if not self.last_output_dir or not os.path.isdir(self.last_output_dir):
            messagebox.showinfo('提示', '当前还没有可打开的输出目录，请先运行一次计算。')
            return
        try:
            if sys.platform.startswith('win'):
                os.startfile(self.last_output_dir)
            elif sys.platform == 'darwin':
                import subprocess
                subprocess.Popen(['open', self.last_output_dir])
            else:
                import subprocess
                subprocess.Popen(['xdg-open', self.last_output_dir])
        except Exception as e:
            messagebox.showerror('错误', f'无法打开输出目录：{e}')

    def set_busy(self, is_busy, status_text=None):
        self.btn_calculate.configure(state=('disabled' if is_busy else 'normal'))
        if status_text:
            self.status_var.set(status_text)

    def ui(self, func, *args, **kwargs):
        self.root.after(0, lambda: func(*args, **kwargs))

    def select_file(self):
        file_path = filedialog.askopenfilename(
            title='选择 CSV / 文本数据文件',
            filetypes=[('CSV Files', '*.csv'), ('Text Files', '*.txt'), ('All Files', '*.*')]
        )
        if file_path:
            self.file_var.set(file_path)

    def paste_from_clipboard(self):
        try:
            if pyperclip is None:
                raise RuntimeError('未安装 pyperclip')
            clip_text = pyperclip.paste()
            if clip_text:
                self.text_paste_input.delete('1.0', tk.END)
                self.text_paste_input.insert('1.0', clip_text)
        except Exception:
            messagebox.showerror('错误', '无法访问剪贴板，请手动粘贴 (Ctrl+V)，或安装 pyperclip。')

    def copy_output_to_clipboard(self):
        try:
            output_text = self.text_output.get('1.0', tk.END).strip()
            if not output_text:
                messagebox.showwarning('提示', '输出区域为空，无可复制内容。')
                return
            if pyperclip is None:
                raise RuntimeError('未安装 pyperclip')
            pyperclip.copy(output_text)
            messagebox.showinfo('成功', '输出内容已复制到剪贴板。')
        except Exception as e:
            messagebox.showerror('错误', f'复制失败: {str(e)}')

    def start_unified_calculation(self):
        raw_text = self.text_paste_input.get('1.0', tk.END).strip()
        file_path = self.file_var.get().strip()

        self.clear_output()
        self.set_busy(True, '处理中...')

        def run_logic():
            try:
                if raw_text:
                    self.process_raw_text(raw_text, source_label='Paste')
                elif file_path and os.path.exists(file_path):
                    self.process_file(file_path)
                else:
                    self.ui(messagebox.showwarning, '提示', '请粘贴数据或选择文件。')
                    self.ui(self.set_busy, False, '就绪')
            except Exception as e:
                self.ui(self.append_output, f'运行错误: {str(e)}\n')
                self.ui(self.set_busy, False, '就绪')

        thread = threading.Thread(target=run_logic, daemon=True)
        thread.start()

    def process_file(self, file_path):
        log_lines = [f"[0/4] 正在读取文件: {os.path.basename(file_path)}\n"]
        self.ui(self.append_output, ''.join(log_lines))

        raw_text, encoding_used, err = read_text_file_with_fallbacks(file_path)
        if raw_text is None:
            self.ui(self.append_output, f'错误：无法读取文件。{err if err else ""}\n')
            self.ui(self.set_busy, False, '就绪')
            return

        self.process_raw_text(raw_text, source_label=file_path, encoding_used=encoding_used)

    def process_raw_text(self, raw_text, source_label='Paste', encoding_used=None):
        log_lines = []
        try:
            workflow_result = run_calculation_workflow(
                raw_text,
                source_label=source_label,
                encoding_used=encoding_used,
            )

            if not workflow_result.ok:
                log_lines.append('❌ 数据解析失败\n')
                log_lines.append(f"原因: {workflow_result.error or '未知错误'}\n")
                log_lines.append('提示：请检查分隔符、空行、合并单元格或文本格式。\n')
                self.ui(self.append_output, ''.join(log_lines))
                self.ui(self.set_busy, False, '就绪')
                return

            df = workflow_result.df
            meta = workflow_result.meta
            results = workflow_result.results
            status_msg = workflow_result.status_msg
            removed_count = workflow_result.removed_count
            detail = workflow_result.detail

            log_lines.append(f'[1/4] 数据源: {source_label}\n')
            if encoding_used:
                log_lines.append(f'      文件编码: {encoding_used}\n')
            log_lines.append(f"      数据形状: {df.shape[0]} 行 x {df.shape[1]} 列\n")
            log_lines.append(f"      表头识别: {meta.get('header_note', '')}\n")
            log_lines.append(f"      列名: {', '.join(map(str, meta.get('columns', [])))}\n")
            log_lines.append(f"      图片字体: {MATPLOTLIB_FONT_NAME} ({MATPLOTLIB_FONT_SOURCE})\n")
            log_lines.append('\n[2/4] 数据预览 (前 5 行):\n')
            log_lines.append(preview_dataframe_text(df, n=5) + '\n\n')
            log_lines.append('[3/4] 开始全局拟合 (共享渐近线 A/D，每组独立 B/C)...\n')
            log_lines.append('-' * 42 + '\n')

            if removed_count > 0:
                log_lines.append(f'⚠️ 已移除 {removed_count} 个非正浓度数据点（4PL 要求 x > 0）\n')

            if status_msg != 'Success':
                log_lines.append(f'拟合出错: {status_msg}\n')
            else:
                gp = detail.get('global_params', {}) if detail else {}
                log_lines.append(
                    f"拟合成功。共享参数: A={gp.get('A', np.nan):.4f}, D={gp.get('D', np.nan):.4f}\n"
                )

            log_lines.append('\n' + '-' * 42 + '\n')
            log_lines.append('[4/4] 计算完成，结果汇总:\n\n')
            log_lines.append(format_results_table(results) + '\n\n')

            if results:
                warn_rows = [r for r in results if str(r.get('Warning', '')).strip()]
                if warn_rows:
                    log_lines.append('异常/提示信息:\n')
                    for r in warn_rows:
                        log_lines.append(f" - {r['Group']}: {r['Warning']}\n")
                    log_lines.append('\n')

                self.last_output_dir = workflow_result.output_dir

                log_lines.append('输出文件位置:\n')
                log_lines.append(f'{workflow_result.output_dir}\n')
                for fp in workflow_result.saved_files:
                    log_lines.append(f'  · {os.path.basename(fp)}\n')
            else:
                log_lines.append('未生成有效结果，无需保存。\n')

        except Exception as e:
            log_lines.append(f'\n[ERROR] 发生未知错误: {str(e)}\n')
            log_lines.append(traceback.format_exc() + '\n')
        finally:
            self.ui(self.append_output, ''.join(log_lines))
            self.ui(self.set_busy, False, '就绪')
