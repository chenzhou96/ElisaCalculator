import json
import os
import sys
import threading
import traceback
from fractions import Fraction

import numpy as np

import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext, ttk

try:
    import pyperclip
except Exception:
    pyperclip = None

from ..common import resource_path, sanitize_filename
from ..io.readers import preview_dataframe_text, read_text_file_with_fallbacks
from ..io.writers import format_results_table
from ..services.workflow import (
    calculate_workflow_report,
    export_workflow_outputs,
    parse_workflow_input,
)
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
        self.recent_file_var = tk.StringVar(value='')
        self.status_var = tk.StringVar(value='就绪')
        self.x_col_var = tk.StringVar(value='')
        self.y_col_count_var = tk.StringVar(value='0')
        self.available_columns = []
        self.selected_y_cols = []
        self.recent_files = []
        self.latest_results = []
        self.latest_warning_rows = []
        self.latest_export_files = []
        self.displayed_result_rows = []
        self.result_filter_var = tk.StringVar(value='全部')
        self.result_sort_var = tk.StringVar(value='告警优先')
        self.result_search_var = tk.StringVar(value='')
        self.result_detail_var = tk.StringVar(value='未选择条目')
        self.mapping_profiles = {}
        self.ui_state_file = os.path.join(os.path.expanduser('~'), '.elisa_calculator_ui_state.json')
        self.image_viewer = None
        self.summary_vars = {
            'source': tk.StringVar(value='未载入'),
            'shape': tk.StringVar(value='-'),
            'groups': tk.StringVar(value='-'),
            'fit': tk.StringVar(value='等待计算'),
            'export': tk.StringVar(value='-'),
            'success_groups': tk.StringVar(value='0'),
            'warning_groups': tk.StringVar(value='0'),
            'output_files': tk.StringVar(value='0'),
        }
        self.last_output_dir = None
        self._build_root()
        self._build_styles()
        self._build_ui()
        self._bind_shortcuts()
        self._load_ui_state()
        self.root.protocol('WM_DELETE_WINDOW', self._on_close)

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

        recent_row = tk.Frame(file_inner, bg=self.colors['panel'])
        recent_row.pack(fill='x', pady=(10, 0))
        tk.Label(
            recent_row,
            text='最近文件',
            bg=self.colors['panel'],
            fg=self.colors['muted'],
            font=('Segoe UI', 9)
        ).pack(side='left')
        self.cmb_recent_files = ttk.Combobox(recent_row, textvariable=self.recent_file_var, state='readonly', width=52)
        self.cmb_recent_files.pack(side='left', fill='x', expand=True, padx=(10, 0))
        self.cmb_recent_files.bind('<<ComboboxSelected>>', self._apply_recent_file)

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
        self.progress = ttk.Progressbar(action_inner, mode='indeterminate')
        self.progress.pack(fill='x', pady=(8, 0))

        tk.Label(
            action_inner,
            text='计算完成后会自动输出: EC50_Summary.csv, 每组拟合曲线图, 以及所有组总览图',
            bg=self.colors['panel'], fg=self.colors['subtext'], font=('Segoe UI', 10), wraplength=760, justify='left'
        ).pack(anchor='w', pady=(6, 12))

        primary_btn_row = tk.Frame(action_inner, bg=self.colors['panel'])
        primary_btn_row.pack(fill='x', pady=(2, 0))
        self.btn_preview = ttk.Button(
            primary_btn_row,
            text='预览解析',
            style='Soft.TButton',
            command=self.start_preview_current_input
        )
        self.btn_preview.pack(side='left')
        self.btn_calculate = ttk.Button(
            primary_btn_row,
            text='开始计算',
            style='Accent.TButton',
            command=self.start_unified_calculation
        )
        self.btn_calculate.pack(side='left', fill='x', expand=True, padx=(10, 0))

        btn_row = tk.Frame(action_inner, bg=self.colors['panel'])
        btn_row.pack(fill='x', pady=(10, 0))
        ttk.Button(btn_row, text='清空当前输入', style='Soft.TButton', command=self.clear_current_input).pack(side='left')
        ttk.Button(btn_row, text='复制输出日志', style='Soft.TButton', command=self.copy_output_to_clipboard).pack(side='left', padx=(10, 0))
        self.btn_open_output = ttk.Button(btn_row, text='打开输出目录', style='Soft.TButton', command=self.open_output_dir)
        self.btn_open_output.pack(side='left', padx=(10, 0))
        ttk.Button(btn_row, text='清空输出日志', style='Soft.TButton', command=self.clear_output).pack(side='left', padx=(10, 0))

        mapping_wrap = tk.Frame(action_inner, bg='#F8FBFF', highlightthickness=1, highlightbackground=self.colors['border'])
        mapping_wrap.pack(fill='x', pady=(10, 0))
        tk.Label(
            mapping_wrap,
            text='列映射确认',
            bg='#F8FBFF',
            fg=self.colors['text'],
            font=('Segoe UI', 10, 'bold')
        ).pack(anchor='w', padx=12, pady=(10, 4))

        x_row = tk.Frame(mapping_wrap, bg='#F8FBFF')
        x_row.pack(fill='x', padx=12, pady=(0, 6))
        tk.Label(
            x_row,
            text='浓度列',
            bg='#F8FBFF',
            fg=self.colors['muted'],
            font=('Segoe UI', 9)
        ).pack(side='left')
        self.cmb_xcol = ttk.Combobox(x_row, state='readonly', textvariable=self.x_col_var, width=26)
        self.cmb_xcol.pack(side='left', fill='x', expand=True, padx=(10, 0))
        self.cmb_xcol.bind('<<ComboboxSelected>>', self._on_x_column_changed)

        y_header = tk.Frame(mapping_wrap, bg='#F8FBFF')
        y_header.pack(fill='x', padx=12)
        tk.Label(
            y_header,
            text='分组列',
            bg='#F8FBFF',
            fg=self.colors['muted'],
            font=('Segoe UI', 9)
        ).pack(side='left')
        tk.Label(
            y_header,
            textvariable=self.y_col_count_var,
            bg='#F8FBFF',
            fg=self.colors['text'],
            font=('Segoe UI', 9, 'bold')
        ).pack(side='right')

        y_list_wrap = tk.Frame(mapping_wrap, bg='#F8FBFF')
        y_list_wrap.pack(fill='x', padx=12, pady=(4, 6))
        self.list_ycols = tk.Listbox(
            y_list_wrap,
            height=5,
            selectmode=tk.MULTIPLE,
            exportselection=False,
            relief='flat',
            highlightthickness=1,
            highlightbackground=self.colors['border']
        )
        self.list_ycols.pack(fill='x')
        self.list_ycols.bind('<<ListboxSelect>>', self._on_y_columns_changed)

        y_btn_row = tk.Frame(mapping_wrap, bg='#F8FBFF')
        y_btn_row.pack(fill='x', padx=12, pady=(0, 10))
        ttk.Button(y_btn_row, text='全选分组', style='Soft.TButton', command=self.select_all_y_columns).pack(side='left')
        ttk.Button(y_btn_row, text='清空分组', style='Soft.TButton', command=self.clear_y_columns).pack(side='left', padx=(8, 0))

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
            text='先看解析摘要，再查看详细日志和结果输出',
            style='Body.TLabel', wraplength=340
        ).pack(anchor='w', pady=(6, 12))

        summary_wrap = tk.Frame(result_inner, bg='#F8FBFF', highlightthickness=1, highlightbackground=self.colors['border'])
        summary_wrap.pack(fill='x', pady=(0, 12))
        self._add_summary_row(summary_wrap, '数据源', self.summary_vars['source'])
        self._add_summary_row(summary_wrap, '数据形状', self.summary_vars['shape'])
        self._add_summary_row(summary_wrap, '检测组数', self.summary_vars['groups'])
        self._add_summary_row(summary_wrap, '拟合状态', self.summary_vars['fit'])
        self._add_summary_row(summary_wrap, '导出状态', self.summary_vars['export'])

        stats_row = tk.Frame(summary_wrap, bg='#F8FBFF', padx=12, pady=6)
        stats_row.pack(fill='x')
        tk.Label(stats_row, text='成功组', bg='#F8FBFF', fg=self.colors['muted'], font=('Segoe UI', 9)).pack(side='left')
        tk.Label(stats_row, textvariable=self.summary_vars['success_groups'], bg='#F8FBFF', fg=self.colors['success'], font=('Segoe UI', 9, 'bold')).pack(side='left', padx=(6, 14))
        tk.Label(stats_row, text='告警组', bg='#F8FBFF', fg=self.colors['muted'], font=('Segoe UI', 9)).pack(side='left')
        tk.Label(stats_row, textvariable=self.summary_vars['warning_groups'], bg='#F8FBFF', fg=self.colors['warning'], font=('Segoe UI', 9, 'bold')).pack(side='left', padx=(6, 14))
        tk.Label(stats_row, text='输出文件', bg='#F8FBFF', fg=self.colors['muted'], font=('Segoe UI', 9)).pack(side='left')
        tk.Label(stats_row, textvariable=self.summary_vars['output_files'], bg='#F8FBFF', fg=self.colors['text'], font=('Segoe UI', 9, 'bold')).pack(side='left', padx=(6, 0))

        summary_action_row = tk.Frame(summary_wrap, bg='#F8FBFF', padx=12, pady=(0, 10))
        summary_action_row.pack(fill='x')
        self.btn_show_warnings = ttk.Button(summary_action_row, text='查看告警详情', style='Soft.TButton', command=self.show_warning_details)
        self.btn_show_warnings.pack(side='left')
        self.btn_open_from_summary = ttk.Button(summary_action_row, text='打开输出目录', style='Soft.TButton', command=self.open_output_dir)
        self.btn_open_from_summary.pack(side='left', padx=(8, 0))

        preview_head = tk.Frame(result_inner, bg=self.colors['panel'])
        preview_head.pack(fill='x')
        ttk.Label(preview_head, text='解析预览', style='Title.TLabel').pack(side='left')
        ttk.Label(
            preview_head,
            text='显示前 5 行和列识别结果',
            style='Muted.TLabel'
        ).pack(side='right')

        preview_wrap, self.text_preview = self._make_textbox(result_inner, height=9, font=('Consolas', 10))
        preview_wrap.pack(fill='x', pady=(8, 12))

        browse_head = tk.Frame(result_inner, bg=self.colors['panel'])
        browse_head.pack(fill='x')
        ttk.Label(browse_head, text='结果浏览', style='Title.TLabel').pack(side='left')
        self.entry_result_search = ttk.Entry(browse_head, textvariable=self.result_search_var, width=18)
        self.entry_result_search.pack(side='right', padx=(0, 8))
        self.entry_result_search.bind('<KeyRelease>', self._on_result_filter_changed)
        self.cmb_result_sort = ttk.Combobox(
            browse_head,
            textvariable=self.result_sort_var,
            state='readonly',
            width=10,
            values=['告警优先', '按EC50升序', '按EC50降序', '按R2降序']
        )
        self.cmb_result_sort.pack(side='right')
        self.cmb_result_sort.bind('<<ComboboxSelected>>', self._on_result_filter_changed)
        self.cmb_result_filter = ttk.Combobox(
            browse_head,
            textvariable=self.result_filter_var,
            state='readonly',
            width=10,
            values=['全部', '仅告警', '仅成功', '仅跳过']
        )
        self.cmb_result_filter.pack(side='right', padx=(0, 8))
        self.cmb_result_filter.bind('<<ComboboxSelected>>', self._on_result_filter_changed)

        result_list_wrap = tk.Frame(result_inner, bg=self.colors['panel'])
        result_list_wrap.pack(fill='x', pady=(8, 8))
        self.list_results = tk.Listbox(
            result_list_wrap,
            height=7,
            selectmode=tk.SINGLE,
            exportselection=False,
            relief='flat',
            highlightthickness=1,
            highlightbackground=self.colors['border']
        )
        self.list_results.pack(fill='x')
        self.list_results.bind('<<ListboxSelect>>', self._on_result_selected)

        result_action_row = tk.Frame(result_inner, bg=self.colors['panel'])
        result_action_row.pack(fill='x', pady=(0, 12))
        self.btn_result_detail = ttk.Button(result_action_row, text='查看选中详情', style='Soft.TButton', command=self.show_selected_result_detail)
        self.btn_result_detail.pack(side='left')
        self.btn_result_copy = ttk.Button(result_action_row, text='复制当前组报告', style='Soft.TButton', command=self.copy_selected_result_detail)
        self.btn_result_copy.pack(side='left', padx=(8, 0))
        self.btn_result_plot_inline = ttk.Button(result_action_row, text='前端查看组图', style='Soft.TButton', command=self.view_selected_group_plot_inline)
        self.btn_result_plot_inline.pack(side='left', padx=(8, 0))
        self.btn_result_plot = ttk.Button(result_action_row, text='打开选中组图', style='Soft.TButton', command=self.open_selected_group_plot)
        self.btn_result_plot.pack(side='left', padx=(8, 0))
        self.btn_result_overview = ttk.Button(result_action_row, text='打开总览图', style='Soft.TButton', command=self.open_overview_plot)
        self.btn_result_overview.pack(side='left', padx=(8, 0))

        tk.Label(
            result_inner,
            textvariable=self.result_detail_var,
            bg=self.colors['panel'],
            fg=self.colors['muted'],
            font=('Segoe UI', 9),
            justify='left',
            anchor='w',
            wraplength=340
        ).pack(fill='x', pady=(0, 12))

        ttk.Label(
            result_inner,
            text='运行日志',
            style='Title.TLabel'
        ).pack(anchor='w', pady=(0, 8))

        output_wrap, self.text_output = self._make_textbox(result_inner, height=18, font=('Consolas', 10))
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

    def _bind_shortcuts(self):
        self.root.bind('<Control-Return>', lambda _event: self.start_unified_calculation())
        self.root.bind('<Control-Shift-Return>', lambda _event: self.start_preview_current_input())
        self.root.bind('<Control-l>', lambda _event: self.clear_output())

    def _on_close(self):
        self._save_ui_state()
        self.root.destroy()

    def _load_ui_state(self):
        try:
            if not os.path.exists(self.ui_state_file):
                return
            with open(self.ui_state_file, 'r', encoding='utf-8') as f:
                state = json.load(f)

            recent_files = state.get('recent_files', [])
            self.recent_files = [p for p in recent_files if isinstance(p, str) and os.path.exists(p)]
            if self.recent_files:
                self.cmb_recent_files['values'] = self.recent_files
                self.recent_file_var.set(self.recent_files[0])

            mapping_profiles = state.get('mapping_profiles', {})
            if isinstance(mapping_profiles, dict):
                self.mapping_profiles = mapping_profiles

            browser_prefs = state.get('browser_prefs', {})
            if isinstance(browser_prefs, dict):
                filter_value = browser_prefs.get('filter', '全部')
                sort_value = browser_prefs.get('sort', '告警优先')
                search_value = browser_prefs.get('search', '')
                if filter_value in ['全部', '仅告警', '仅成功', '仅跳过']:
                    self.result_filter_var.set(filter_value)
                if sort_value in ['告警优先', '按EC50升序', '按EC50降序', '按R2降序']:
                    self.result_sort_var.set(sort_value)
                if isinstance(search_value, str):
                    self.result_search_var.set(search_value)
        except Exception:
            self.mapping_profiles = {}

    def _save_ui_state(self):
        state = {
            'recent_files': self.recent_files[:8],
            'mapping_profiles': self.mapping_profiles,
            'browser_prefs': {
                'filter': self.result_filter_var.get(),
                'sort': self.result_sort_var.get(),
                'search': self.result_search_var.get(),
            },
        }
        try:
            with open(self.ui_state_file, 'w', encoding='utf-8') as f:
                json.dump(state, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def _mapping_profile_key(self, source_label, columns):
        normalized_columns = '|'.join(map(str, columns))
        if source_label and source_label != 'Paste':
            return f"file:{os.path.normpath(source_label)}::{normalized_columns}"
        return f"paste::{normalized_columns}"

    def _remember_mapping_profile(self, source_label, columns, x_col, y_cols):
        if not columns or not x_col or not y_cols:
            return
        key = self._mapping_profile_key(source_label, columns)
        self.mapping_profiles[key] = {
            'x_col': x_col,
            'y_cols': list(y_cols),
        }
        if len(self.mapping_profiles) > 60:
            keys = list(self.mapping_profiles.keys())
            for stale_key in keys[:-60]:
                self.mapping_profiles.pop(stale_key, None)

    def _get_saved_mapping_profile(self, source_label, columns):
        if not columns:
            return None
        key = self._mapping_profile_key(source_label, columns)
        profile = self.mapping_profiles.get(key)
        if not profile:
            return None
        return {
            'x_col': profile.get('x_col'),
            'y_cols': profile.get('y_cols', []),
        }

    def _add_summary_row(self, parent, label_text, value_var):
        row = tk.Frame(parent, bg='#F8FBFF', padx=12, pady=6)
        row.pack(fill='x')
        tk.Label(
            row,
            text=label_text,
            bg='#F8FBFF',
            fg=self.colors['muted'],
            font=('Segoe UI', 9)
        ).pack(side='left')
        tk.Label(
            row,
            textvariable=value_var,
            bg='#F8FBFF',
            fg=self.colors['text'],
            font=('Segoe UI', 9, 'bold')
        ).pack(side='right')

    def clear_preview(self):
        self.text_preview.delete('1.0', tk.END)

    def _set_column_options(self, columns, preferred_x=None, preferred_y=None):
        self.available_columns = list(columns)
        self.cmb_xcol['values'] = self.available_columns

        if not self.available_columns:
            self.x_col_var.set('')
            self.list_ycols.delete(0, tk.END)
            self.selected_y_cols = []
            self.y_col_count_var.set('0')
            return

        current_x = self.x_col_var.get()
        if preferred_x in self.available_columns:
            current_x = preferred_x
        if current_x not in self.available_columns:
            current_x = self.available_columns[0]
        self.x_col_var.set(current_x)
        restore_y = preferred_y if preferred_y is not None else self.selected_y_cols
        self._refresh_y_columns_by_x(current_x, preferred_y=restore_y)

    def _refresh_y_columns_by_x(self, x_col, preferred_y=None):
        y_candidates = [col for col in self.available_columns if col != x_col]
        preferred = set(preferred_y or [])
        self.list_ycols.delete(0, tk.END)
        for col in y_candidates:
            self.list_ycols.insert(tk.END, str(col))
        if y_candidates:
            selected_any = False
            for idx, col in enumerate(y_candidates):
                if col in preferred:
                    self.list_ycols.select_set(idx)
                    selected_any = True
            if not selected_any:
                self.list_ycols.select_set(0, tk.END)
        self._on_y_columns_changed()

    def _on_x_column_changed(self, _event=None):
        self._refresh_y_columns_by_x(self.x_col_var.get(), preferred_y=self.selected_y_cols)

    def _on_y_columns_changed(self, _event=None):
        count = len(self.list_ycols.curselection())
        self.selected_y_cols = [self.list_ycols.get(i) for i in self.list_ycols.curselection()]
        self.y_col_count_var.set(str(count))
        self.summary_vars['groups'].set(str(count))

    def _remember_recent_file(self, file_path):
        if not file_path:
            return
        normalized = os.path.normpath(file_path)
        self.recent_files = [p for p in self.recent_files if os.path.normpath(p) != normalized]
        self.recent_files.insert(0, file_path)
        self.recent_files = self.recent_files[:8]
        self.cmb_recent_files['values'] = self.recent_files
        self.recent_file_var.set(file_path)

    def _apply_recent_file(self, _event=None):
        selected = self.recent_file_var.get().strip()
        if selected:
            self.file_var.set(selected)

    def show_warning_details(self):
        if not self.latest_warning_rows:
            messagebox.showinfo('提示', '当前无告警信息。')
            return
        lines = ['\n[告警详情]']
        for row in self.latest_warning_rows:
            lines.append(f"- {row.get('Group', '')}: {row.get('Warning', '')}")
        self.append_output('\n'.join(lines) + '\n')

    def _on_result_filter_changed(self, _event=None):
        self._refresh_result_browser()

    def _to_sortable_number(self, value, default):
        try:
            val = float(value)
            if np.isfinite(val):
                return val
        except Exception:
            pass
        return default

    def _refresh_result_browser(self):
        self.list_results.delete(0, tk.END)
        self.displayed_result_rows = []

        if not self.latest_results:
            self.result_detail_var.set('未选择条目')
            return

        filter_mode = self.result_filter_var.get().strip() or '全部'
        sort_mode = self.result_sort_var.get().strip() or '告警优先'
        keyword = self.result_search_var.get().strip().lower()

        filtered_rows = []

        for row in self.latest_results:
            status = str(row.get('Status', ''))
            warning = str(row.get('Warning', '')).strip()
            if filter_mode == '仅告警' and not warning:
                continue
            if filter_mode == '仅成功' and status != 'Success':
                continue
            if filter_mode == '仅跳过' and status != 'Skipped':
                continue

            if keyword:
                group_text = str(row.get('Group', '')).lower()
                warning_text = warning.lower()
                if keyword not in group_text and keyword not in warning_text and keyword not in status.lower():
                    continue

            filtered_rows.append(row)

        if sort_mode == '按EC50升序':
            filtered_rows.sort(key=lambda r: self._to_sortable_number(r.get('EC50', np.nan), float('inf')))
        elif sort_mode == '按EC50降序':
            filtered_rows.sort(key=lambda r: self._to_sortable_number(r.get('EC50', np.nan), float('-inf')), reverse=True)
        elif sort_mode == '按R2降序':
            filtered_rows.sort(key=lambda r: self._to_sortable_number(r.get('R2', np.nan), float('-inf')), reverse=True)
        else:
            filtered_rows.sort(key=lambda r: (0 if str(r.get('Warning', '')).strip() else 1, str(r.get('Group', ''))))

        for row in filtered_rows:
            status = str(row.get('Status', ''))
            ec50_val = row.get('EC50', np.nan)
            ec50_txt = 'N/A' if not np.isfinite(ec50_val) else f'{ec50_val:.4g}'
            item_text = f"{row.get('Group', '')} | {status} | EC50={ec50_txt}"
            warning = str(row.get('Warning', '')).strip()
            if warning:
                item_text += ' | ⚠'

            self.list_results.insert(tk.END, item_text)
            self.displayed_result_rows.append(row)

        if self.displayed_result_rows:
            self.list_results.selection_set(0)
            self._on_result_selected()
        else:
            self.result_detail_var.set('当前筛选下无结果')

    def _on_result_selected(self, _event=None):
        selection = self.list_results.curselection()
        if not selection:
            self.result_detail_var.set('未选择条目')
            return

        row = self.displayed_result_rows[selection[0]]
        warning = str(row.get('Warning', '')).strip()
        detail_text = (
            f"组: {row.get('Group', '')} | 状态: {row.get('Status', '')} | "
            f"R2: {row.get('R2', np.nan):.4f} | RMSE: {row.get('RMSE', np.nan):.4f}"
        )
        if warning:
            detail_text += f"\n告警: {warning}"
        if self._focus_log_for_group(str(row.get('Group', ''))):
            detail_text += '\n日志定位: 已定位到输出日志中的该组条目'
        else:
            detail_text += '\n日志定位: 未找到对应日志条目'
        self.result_detail_var.set(detail_text)

    def _focus_log_for_group(self, group_name):
        if not group_name:
            return False
        self.text_output.tag_remove('group_hit', '1.0', tk.END)
        idx = self.text_output.search(group_name, '1.0', tk.END, nocase=True)
        if not idx:
            return False
        end_idx = f"{idx}+{len(group_name)}c"
        self.text_output.tag_add('group_hit', idx, end_idx)
        self.text_output.tag_config('group_hit', background='#FFF4CC')
        self.text_output.see(idx)
        return True

    def _get_selected_result_row(self):
        selection = self.list_results.curselection()
        if not selection:
            return None
        idx = selection[0]
        if idx < 0 or idx >= len(self.displayed_result_rows):
            return None
        return self.displayed_result_rows[idx]

    def show_selected_result_detail(self):
        row = self._get_selected_result_row()
        if row is None:
            messagebox.showinfo('提示', '请先在结果浏览中选择一组。')
            return
        lines = self._build_selected_result_lines(row)
        self.append_output('\n'.join(lines) + '\n')

    def _build_selected_result_lines(self, row):
        lines = [
            '\n[选中组详情]',
            f"- Group: {row.get('Group', '')}",
            f"- Status: {row.get('Status', '')}",
            f"- EC50: {row.get('EC50', np.nan)}",
            f"- Slope: {row.get('Slope', np.nan)}",
            f"- R2: {row.get('R2', np.nan)}",
            f"- RMSE: {row.get('RMSE', np.nan)}",
        ]
        warning = str(row.get('Warning', '')).strip()
        if warning:
            lines.append(f"- Warning: {warning}")
        return lines

    def copy_selected_result_detail(self):
        row = self._get_selected_result_row()
        if row is None:
            messagebox.showinfo('提示', '请先在结果浏览中选择一组。')
            return
        text = '\n'.join(self._build_selected_result_lines(row)).strip()
        try:
            if pyperclip is not None:
                pyperclip.copy(text)
            else:
                self.root.clipboard_clear()
                self.root.clipboard_append(text)
            messagebox.showinfo('成功', '当前组报告已复制到剪贴板。')
        except Exception as e:
            messagebox.showerror('错误', f'复制失败：{e}')

    def _collect_group_plot_files(self):
        files = []
        for fp in self.latest_export_files:
            if not os.path.exists(fp):
                continue
            name = os.path.basename(fp)
            if name.endswith('_fit.png'):
                files.append(fp)
        files.sort(key=lambda p: os.path.basename(p).lower())
        return files

    def _get_group_plot_file(self, group_name):
        expected_name = f"{sanitize_filename(group_name)}_fit.png"
        for fp in self.latest_export_files:
            if os.path.basename(fp) == expected_name and os.path.exists(fp):
                return fp
        return None

    def _create_image_viewer(self):
        window = tk.Toplevel(self.root)
        window.title('拟合图查看器')
        window.geometry('980x720')
        window.minsize(640, 480)
        window.configure(bg=self.colors['panel'])

        top = tk.Frame(window, bg=self.colors['panel'], padx=10, pady=8)
        top.pack(fill='x')

        title_var = tk.StringVar(value='未加载图片')
        zoom_var = tk.StringVar(value='100%')

        ttk.Button(top, text='上一张', style='Soft.TButton', command=lambda: self._viewer_step(-1)).pack(side='left')
        ttk.Button(top, text='下一张', style='Soft.TButton', command=lambda: self._viewer_step(1)).pack(side='left', padx=(8, 0))
        ttk.Button(top, text='缩小', style='Soft.TButton', command=lambda: self._viewer_zoom(1 / 1.25)).pack(side='left', padx=(16, 0))
        ttk.Button(top, text='放大', style='Soft.TButton', command=lambda: self._viewer_zoom(1.25)).pack(side='left', padx=(8, 0))
        ttk.Button(top, text='重置', style='Soft.TButton', command=self._viewer_reset_zoom).pack(side='left', padx=(8, 0))
        ttk.Button(top, text='适配', style='Soft.TButton', command=self._viewer_fit_to_window).pack(side='left', padx=(8, 0))

        tk.Label(top, textvariable=zoom_var, bg=self.colors['panel'], fg=self.colors['muted'], font=('Segoe UI', 9, 'bold')).pack(side='right')

        tk.Label(
            window,
            textvariable=title_var,
            bg=self.colors['panel'],
            fg=self.colors['text'],
            font=('Segoe UI', 10, 'bold'),
            anchor='w',
            padx=12
        ).pack(fill='x', pady=(0, 4))

        image_frame = tk.Frame(window, bg=self.colors['panel'])
        image_frame.pack(fill='both', expand=True, padx=8, pady=(0, 8))
        image_canvas = tk.Canvas(
            image_frame,
            bg=self.colors['panel'],
            highlightthickness=1,
            highlightbackground=self.colors['border'],
            bd=0,
            relief='flat'
        )
        image_canvas.pack(fill='both', expand=True)

        viewer = {
            'window': window,
            'title_var': title_var,
            'zoom_var': zoom_var,
            'image_canvas': image_canvas,
            'files': [],
            'index': 0,
            'base_image': None,
            'display_image': None,
            'image_item': None,
            'zoom': 1.0,
            'auto_fit': True,
            'drag_from': None,
        }

        window.bind('<Left>', lambda _event: (self._viewer_step(-1), 'break')[1])
        window.bind('<Right>', lambda _event: (self._viewer_step(1), 'break')[1])
        window.bind('<Key-plus>', lambda _event: (self._viewer_zoom(1.25), 'break')[1])
        window.bind('<Key-equal>', lambda _event: (self._viewer_zoom(1.25), 'break')[1])
        window.bind('<Key-KP_Add>', lambda _event: (self._viewer_zoom(1.25), 'break')[1])
        window.bind('<Key-minus>', lambda _event: (self._viewer_zoom(1 / 1.25), 'break')[1])
        window.bind('<Key-KP_Subtract>', lambda _event: (self._viewer_zoom(1 / 1.25), 'break')[1])
        window.bind('<Key-0>', lambda _event: (self._viewer_reset_zoom(), 'break')[1])
        window.bind('<Key-f>', lambda _event: (self._viewer_fit_to_window(), 'break')[1])
        window.bind('<Key-F>', lambda _event: (self._viewer_fit_to_window(), 'break')[1])

        image_canvas.bind('<MouseWheel>', self._viewer_on_mousewheel)
        image_canvas.bind('<Button-4>', self._viewer_on_mousewheel)
        image_canvas.bind('<Button-5>', self._viewer_on_mousewheel)
        image_canvas.bind('<ButtonPress-1>', self._viewer_on_drag_start)
        image_canvas.bind('<B1-Motion>', self._viewer_on_drag_move)
        image_canvas.bind('<ButtonRelease-1>', self._viewer_on_drag_end)

        def on_close():
            self.image_viewer = None
            window.destroy()

        window.protocol('WM_DELETE_WINDOW', on_close)
        image_canvas.bind('<Configure>', lambda _event: self._viewer_handle_resize())
        self.image_viewer = viewer

    def _viewer_handle_resize(self):
        if not self.image_viewer:
            return
        if self.image_viewer.get('auto_fit'):
            self._viewer_fit_to_window()

    def _viewer_load_current(self):
        if not self.image_viewer:
            return False
        files = self.image_viewer['files']
        if not files:
            return False
        idx = self.image_viewer['index']
        image_path = files[idx]
        try:
            base_image = tk.PhotoImage(file=image_path)
        except Exception as e:
            messagebox.showerror('错误', f'无法在前端加载图片：{e}')
            return False

        self.image_viewer['base_image'] = base_image
        base_name = os.path.basename(image_path)
        title_text = f"[{idx + 1}/{len(files)}] {base_name}"
        if base_name.endswith('_fit.png'):
            group_name = base_name[:-8]
            title_text += f" | Group: {group_name}"
        elif base_name == 'EC50_AllGroups_Overview.png':
            title_text += ' | 总览图'
        self.image_viewer['title_var'].set(title_text)
        self._sync_result_selection_by_plot_file(image_path)
        return True

    def _sync_result_selection_by_plot_file(self, image_path):
        if not image_path:
            return
        base_name = os.path.basename(image_path)
        if not base_name.endswith('_fit.png'):
            return

        group_token = base_name[:-8]

        def try_sync_in_displayed_rows():
            for idx, row in enumerate(self.displayed_result_rows):
                if sanitize_filename(str(row.get('Group', ''))) == group_token:
                    self.list_results.selection_clear(0, tk.END)
                    self.list_results.selection_set(idx)
                    self.list_results.see(idx)
                    self._on_result_selected()
                    return True
            return False

        if try_sync_in_displayed_rows():
            return

        if self.result_filter_var.get() != '全部':
            self.result_filter_var.set('全部')
            self._refresh_result_browser()
            try_sync_in_displayed_rows()

    def _viewer_apply_scale(self, scale):
        if not self.image_viewer or self.image_viewer.get('base_image') is None:
            return
        scale = max(0.25, min(4.0, scale))
        frac = Fraction(scale).limit_denominator(8)
        num = max(1, int(frac.numerator))
        den = max(1, int(frac.denominator))

        img = self.image_viewer['base_image']
        if num != 1:
            img = img.zoom(num, num)
        if den != 1:
            img = img.subsample(den, den)

        self.image_viewer['display_image'] = img
        self.image_viewer['zoom'] = scale
        self.image_viewer['zoom_var'].set(f"{int(scale * 100)}%")
        canvas = self.image_viewer['image_canvas']
        if self.image_viewer.get('image_item') is None:
            center_x = canvas.winfo_width() / 2
            center_y = canvas.winfo_height() / 2
            image_item = canvas.create_image(center_x, center_y, image=img, anchor='center')
            self.image_viewer['image_item'] = image_item
        else:
            image_item = self.image_viewer['image_item']
            canvas.itemconfigure(image_item, image=img)
            if self.image_viewer.get('auto_fit'):
                center_x = canvas.winfo_width() / 2
                center_y = canvas.winfo_height() / 2
                canvas.coords(image_item, center_x, center_y)

        canvas.image = img

    def _viewer_fit_to_window(self):
        if not self.image_viewer or self.image_viewer.get('base_image') is None:
            return
        canvas = self.image_viewer['image_canvas']
        available_w = max(1, canvas.winfo_width())
        available_h = max(1, canvas.winfo_height())
        base = self.image_viewer['base_image']
        base_w = max(1, base.width())
        base_h = max(1, base.height())
        scale = min(available_w / base_w, available_h / base_h)
        self.image_viewer['auto_fit'] = True
        self._viewer_apply_scale(scale)

    def _viewer_on_mousewheel(self, event):
        if not self.image_viewer:
            return 'break'
        factor = 1.0
        delta = getattr(event, 'delta', 0)
        if delta > 0 or getattr(event, 'num', None) == 4:
            factor = 1.25
        elif delta < 0 or getattr(event, 'num', None) == 5:
            factor = 1 / 1.25
        if factor != 1.0:
            self._viewer_zoom(factor)
        return 'break'

    def _viewer_on_drag_start(self, event):
        if not self.image_viewer:
            return
        self.image_viewer['drag_from'] = (event.x, event.y)

    def _viewer_on_drag_move(self, event):
        if not self.image_viewer or self.image_viewer.get('image_item') is None:
            return
        drag_from = self.image_viewer.get('drag_from')
        if not drag_from:
            return
        dx = event.x - drag_from[0]
        dy = event.y - drag_from[1]
        canvas = self.image_viewer['image_canvas']
        canvas.move(self.image_viewer['image_item'], dx, dy)
        self.image_viewer['drag_from'] = (event.x, event.y)
        self.image_viewer['auto_fit'] = False

    def _viewer_on_drag_end(self, _event):
        if not self.image_viewer:
            return
        self.image_viewer['drag_from'] = None

    def _viewer_zoom(self, factor):
        if not self.image_viewer:
            return
        current = self.image_viewer.get('zoom', 1.0)
        self.image_viewer['auto_fit'] = False
        self._viewer_apply_scale(current * factor)

    def _viewer_reset_zoom(self):
        if not self.image_viewer:
            return
        self.image_viewer['auto_fit'] = False
        self._viewer_apply_scale(1.0)

    def _viewer_step(self, delta):
        if not self.image_viewer:
            return
        files = self.image_viewer['files']
        if not files:
            return
        self.image_viewer['index'] = (self.image_viewer['index'] + delta) % len(files)
        if self._viewer_load_current():
            canvas = self.image_viewer['image_canvas']
            image_item = self.image_viewer.get('image_item')
            if image_item is not None:
                canvas.coords(image_item, canvas.winfo_width() / 2, canvas.winfo_height() / 2)
            if self.image_viewer.get('auto_fit'):
                self._viewer_fit_to_window()
            else:
                self._viewer_apply_scale(self.image_viewer.get('zoom', 1.0))

    def _open_image_viewer(self, files, start_index=0):
        if not files:
            messagebox.showinfo('提示', '没有可查看的图片。')
            return

        if self.image_viewer is None or not self.image_viewer['window'].winfo_exists():
            self._create_image_viewer()

        self.image_viewer['files'] = files
        self.image_viewer['index'] = max(0, min(start_index, len(files) - 1))
        if self._viewer_load_current():
            self._viewer_fit_to_window()
            self.image_viewer['window'].deiconify()
            self.image_viewer['window'].lift()
            self.image_viewer['window'].focus_force()

    def view_selected_group_plot_inline(self):
        row = self._get_selected_result_row()
        if row is None:
            messagebox.showinfo('提示', '请先在结果浏览中选择一组。')
            return

        group_name = str(row.get('Group', '')).strip()
        if not group_name:
            messagebox.showinfo('提示', '当前条目没有可用组名。')
            return

        target_file = self._get_group_plot_file(group_name)
        group_files = self._collect_group_plot_files()

        if target_file is None or not group_files:
            messagebox.showinfo('提示', '未找到该组对应图片，请先完成计算并导出。')
            return

        start_idx = 0
        for idx, fp in enumerate(group_files):
            if fp == target_file:
                start_idx = idx
                break
        self._open_image_viewer(group_files, start_index=start_idx)

    def open_selected_group_plot(self):
        row = self._get_selected_result_row()
        if row is None:
            messagebox.showinfo('提示', '请先在结果浏览中选择一组。')
            return

        group_name = str(row.get('Group', '')).strip()
        if not group_name:
            messagebox.showinfo('提示', '当前条目没有可用组名。')
            return

        target_file = self._get_group_plot_file(group_name)

        if target_file is None:
            messagebox.showinfo('提示', '未找到该组对应图片，请先完成计算并导出。')
            return

        try:
            if sys.platform.startswith('win'):
                os.startfile(target_file)
            elif sys.platform == 'darwin':
                import subprocess
                subprocess.Popen(['open', target_file])
            else:
                import subprocess
                subprocess.Popen(['xdg-open', target_file])
        except Exception as e:
            messagebox.showerror('错误', f'无法打开组图：{e}')

    def open_overview_plot(self):
        target_file = None
        for fp in self.latest_export_files:
            if os.path.basename(fp) == 'EC50_AllGroups_Overview.png' and os.path.exists(fp):
                target_file = fp
                break

        if target_file is None:
            messagebox.showinfo('提示', '未找到总览图，请先完成计算并导出。')
            return

        self._open_image_viewer([target_file], start_index=0)

    def select_all_y_columns(self):
        if self.list_ycols.size() > 0:
            self.list_ycols.select_set(0, tk.END)
        self._on_y_columns_changed()

    def clear_y_columns(self):
        self.list_ycols.selection_clear(0, tk.END)
        self._on_y_columns_changed()

    def get_column_mapping(self):
        x_col = self.x_col_var.get().strip()
        if not x_col:
            return {}

        selected_indices = self.list_ycols.curselection()
        y_cols = [self.list_ycols.get(i) for i in selected_indices]
        if not y_cols:
            return None

        return {
            'x_col_name': x_col,
            'y_cols_names': y_cols,
        }

    def reset_summary(self):
        self.summary_vars['source'].set('未载入')
        self.summary_vars['shape'].set('-')
        self.summary_vars['groups'].set('-')
        self.summary_vars['fit'].set('等待计算')
        self.summary_vars['export'].set('-')
        self.summary_vars['success_groups'].set('0')
        self.summary_vars['warning_groups'].set('0')
        self.summary_vars['output_files'].set('0')
        self.latest_results = []
        self.latest_warning_rows = []
        self.latest_export_files = []
        self.result_detail_var.set('未选择条目')
        self._refresh_result_browser()

    def update_parse_preview(self, parse_result):
        self.clear_preview()
        if not parse_result.ok:
            self._set_column_options([])
            self.text_preview.insert(tk.END, f"解析失败\n原因: {parse_result.error}\n")
            self.summary_vars['source'].set(parse_result.source_label)
            self.summary_vars['fit'].set('解析失败')
            self.summary_vars['export'].set('未导出')
            return

        df = parse_result.df
        meta = parse_result.meta
        lines = [
            f"来源: {parse_result.source_label}",
            f"表头识别: {meta.get('header_note', '')}",
            f"分隔符: {meta.get('separator', '')}",
            f"列名: {', '.join(map(str, meta.get('columns', [])))}",
            '',
            preview_dataframe_text(df, n=5),
        ]
        self.text_preview.insert(tk.END, '\n'.join(lines).strip() + '\n')
        columns = meta.get('columns', [])
        saved_profile = self._get_saved_mapping_profile(parse_result.source_label, columns)
        preferred_x = saved_profile.get('x_col') if saved_profile else None
        preferred_y = saved_profile.get('y_cols') if saved_profile else None
        self._set_column_options(columns, preferred_x=preferred_x, preferred_y=preferred_y)
        self.summary_vars['source'].set(parse_result.source_label)
        self.summary_vars['shape'].set(f'{df.shape[0]} 行 x {df.shape[1]} 列')
        self.summary_vars['groups'].set(str(len(self.list_ycols.curselection())))
        self.summary_vars['fit'].set('已解析，待计算')
        self.summary_vars['export'].set('未导出')

    def update_result_summary(self, calculation_result, export_result):
        if not calculation_result.ok:
            self.summary_vars['fit'].set('计算失败')
            self.summary_vars['export'].set('未导出')
            self.summary_vars['success_groups'].set('0')
            self.summary_vars['warning_groups'].set('0')
            self.summary_vars['output_files'].set('0')
            self.latest_results = []
            self.latest_warning_rows = []
            self.latest_export_files = []
            return

        if calculation_result.status_msg == 'Success' and calculation_result.report is not None:
            success_rows = [row for row in calculation_result.results if row.get('Status') == 'Success']
            warn_rows = [row for row in calculation_result.results if str(row.get('Warning', '')).strip()]
            self.latest_results = calculation_result.results
            self.latest_warning_rows = warn_rows
            self.summary_vars['fit'].set(f"成功 {len(success_rows)} 组，提示 {len(warn_rows)} 组")
            self.summary_vars['success_groups'].set(str(len(success_rows)))
            self.summary_vars['warning_groups'].set(str(len(warn_rows)))
        else:
            self.summary_vars['fit'].set(calculation_result.status_msg)
            self.summary_vars['success_groups'].set('0')
            self.summary_vars['warning_groups'].set('0')
            self.latest_results = []
            self.latest_warning_rows = []

        self._refresh_result_browser()

        if export_result.skipped:
            self.summary_vars['export'].set('未导出')
            self.summary_vars['output_files'].set('0')
            self.latest_export_files = []
        else:
            self.summary_vars['export'].set(f"已导出 {len(export_result.saved_files)} 个文件")
            self.summary_vars['output_files'].set(str(len(export_result.saved_files)))
            self.latest_export_files = export_result.saved_files

    def get_current_input_payload(self):
        raw_text = self.text_paste_input.get('1.0', tk.END).strip()
        file_path = self.file_var.get().strip()

        if raw_text:
            return True, {
                'raw_text': raw_text,
                'source_label': 'Paste',
                'encoding_used': None,
            }

        if file_path and os.path.exists(file_path):
            self._remember_recent_file(file_path)
            raw_text, encoding_used, err = read_text_file_with_fallbacks(file_path)
            if raw_text is None:
                return False, f'错误：无法读取文件。{err if err else ""}'
            return True, {
                'raw_text': raw_text,
                'source_label': file_path,
                'encoding_used': encoding_used,
            }

        return False, '请粘贴数据或选择文件。'

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
        self.btn_preview.configure(state=('disabled' if is_busy else 'normal'))
        self.btn_calculate.configure(state=('disabled' if is_busy else 'normal'))
        self.btn_show_warnings.configure(state=('disabled' if is_busy else 'normal'))
        self.btn_open_from_summary.configure(state=('disabled' if is_busy else 'normal'))
        self.cmb_recent_files.configure(state=('disabled' if is_busy else 'readonly'))
        self.cmb_result_filter.configure(state=('disabled' if is_busy else 'readonly'))
        self.cmb_result_sort.configure(state=('disabled' if is_busy else 'readonly'))
        self.cmb_xcol.configure(state=('disabled' if is_busy else 'readonly'))
        self.list_ycols.configure(state=('disabled' if is_busy else 'normal'))
        self.list_results.configure(state=('disabled' if is_busy else 'normal'))
        self.btn_result_detail.configure(state=('disabled' if is_busy else 'normal'))
        self.btn_result_copy.configure(state=('disabled' if is_busy else 'normal'))
        self.btn_result_plot_inline.configure(state=('disabled' if is_busy else 'normal'))
        self.btn_result_plot.configure(state=('disabled' if is_busy else 'normal'))
        self.btn_result_overview.configure(state=('disabled' if is_busy else 'normal'))
        if is_busy:
            self.progress.start(10)
        else:
            self.progress.stop()
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
            self._remember_recent_file(file_path)

    def paste_from_clipboard(self):
        try:
            clip_text = ''
            if pyperclip is not None:
                clip_text = pyperclip.paste()
            if not clip_text:
                clip_text = self.root.clipboard_get()
            if clip_text:
                self.text_paste_input.delete('1.0', tk.END)
                self.text_paste_input.insert('1.0', clip_text)
        except Exception:
            messagebox.showerror('错误', '无法访问剪贴板，请手动粘贴 (Ctrl+V)。')

    def copy_output_to_clipboard(self):
        try:
            output_text = self.text_output.get('1.0', tk.END).strip()
            if not output_text:
                messagebox.showwarning('提示', '输出区域为空，无可复制内容。')
                return
            if pyperclip is not None:
                pyperclip.copy(output_text)
            else:
                self.root.clipboard_clear()
                self.root.clipboard_append(output_text)
            messagebox.showinfo('成功', '输出内容已复制到剪贴板。')
        except Exception as e:
            messagebox.showerror('错误', f'复制失败: {str(e)}')

    def start_preview_current_input(self):
        self.clear_output()
        self.reset_summary()
        self.set_busy(True, '解析中...')
        ok, payload = self.get_current_input_payload()
        if not ok:
            messagebox.showwarning('提示', payload)
            self.set_busy(False, '就绪')
            return

        def run_logic():
            parse_result = parse_workflow_input(
                payload['raw_text'],
                source_label=payload['source_label'],
                encoding_used=payload['encoding_used'],
            )
            self.ui(self.update_parse_preview, parse_result)
            self.ui(self.set_busy, False, '就绪')

        thread = threading.Thread(target=run_logic, daemon=True)
        thread.start()

    def start_unified_calculation(self):
        self.clear_output()
        self.reset_summary()
        self.set_busy(True, '处理中...')
        ok, payload = self.get_current_input_payload()
        if not ok:
            messagebox.showwarning('提示', payload)
            self.set_busy(False, '就绪')
            return

        calculator_kwargs = self.get_column_mapping()
        if calculator_kwargs is None:
            messagebox.showwarning('提示', '已选择浓度列，但分组列为空，请至少选择一个分组列。')
            self.set_busy(False, '就绪')
            return

        columns_snapshot = list(self.available_columns)
        if calculator_kwargs:
            self._remember_mapping_profile(
                payload['source_label'],
                columns_snapshot,
                calculator_kwargs.get('x_col_name'),
                calculator_kwargs.get('y_cols_names', []),
            )

        def run_logic():
            try:
                self.process_raw_text(
                    payload['raw_text'],
                    source_label=payload['source_label'],
                    encoding_used=payload['encoding_used'],
                    calculator_kwargs=calculator_kwargs,
                )
            except Exception as e:
                self.ui(self.append_output, f'运行错误: {str(e)}\n')
                self.ui(self.set_busy, False, '就绪')

        thread = threading.Thread(target=run_logic, daemon=True)
        thread.start()

    def process_raw_text(self, raw_text, source_label='Paste', encoding_used=None, calculator_kwargs=None):
        log_lines = []
        try:
            parse_result = parse_workflow_input(
                raw_text,
                source_label=source_label,
                encoding_used=encoding_used,
            )
            self.ui(self.update_parse_preview, parse_result)

            if not parse_result.ok:
                log_lines.append('❌ 数据解析失败\n')
                log_lines.append(f"原因: {parse_result.error or '未知错误'}\n")
                log_lines.append('提示：请检查分隔符、空行、合并单元格或文本格式。\n')
                self.ui(self.append_output, ''.join(log_lines))
                self.ui(self.set_busy, False, '就绪')
                return

            if calculator_kwargs:
                columns = set(parse_result.meta.get('columns', []))
                selected_x = calculator_kwargs.get('x_col_name')
                selected_y = calculator_kwargs.get('y_cols_names', [])
                if selected_x not in columns or any(col not in columns for col in selected_y):
                    calculator_kwargs = None

            calculation_result = calculate_workflow_report(
                parse_result.df,
                calculator_kwargs=calculator_kwargs,
            )
            export_result = export_workflow_outputs(
                calculation_result.report,
                source_label=parse_result.source_label,
            )
            self.ui(self.update_result_summary, calculation_result, export_result)

            df = parse_result.df
            meta = parse_result.meta
            results = calculation_result.results
            status_msg = calculation_result.status_msg
            removed_count = calculation_result.removed_count
            detail = calculation_result.detail

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

                self.last_output_dir = export_result.output_dir

                log_lines.append('输出文件位置:\n')
                log_lines.append(f'{export_result.output_dir}\n')
                for fp in export_result.saved_files:
                    log_lines.append(f'  · {os.path.basename(fp)}\n')
            else:
                log_lines.append('未生成有效结果，无需保存。\n')

        except Exception as e:
            log_lines.append(f'\n[ERROR] 发生未知错误: {str(e)}\n')
            log_lines.append(traceback.format_exc() + '\n')
        finally:
            self.ui(self.append_output, ''.join(log_lines))
            self.ui(self.set_busy, False, '就绪')
