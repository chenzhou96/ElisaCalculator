import pandas as pd
import numpy as np
from scipy.optimize import curve_fit
import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext
import warnings
import os
import threading
import pyperclip  # 需要安装: pip install pyperclip
import sys
from functools import partial

# 忽略拟合过程中可能出现的警告
warnings.filterwarnings('ignore')

def resource_path(relative_path):
    """获取资源绝对路径，兼容 PyInstaller 打包"""
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

def four_param_logistic(x, A, B, C, D):
    """四参数逻辑回归模型 (4PL)"""
    with np.errstate(divide='ignore', invalid='ignore'):
        return D + (A - D) / (1 + (x / C) ** B)

def global_four_param_logistic_model(x, group_indices, n_groups, A, D, *bc_flat):
    """
    用于 curve_fit 的全局拟合模型函数。
    参数:
        x: 所有浓度数据 (1D array)
        group_indices: 每个数据点所属组索引 (0,1,2,...)
        n_groups: 组数
        A, D: 全局共享参数
        bc_flat: 扁平化的 [B1, C1, B2, C2, ..., Bn, Cn]
    返回:
        预测响应值 (与 x 同形状)
    """
    res = np.zeros_like(x, dtype=float)
    if len(bc_flat) != 2 * n_groups:
        raise ValueError("bc_flat 长度应为 2 * n_groups")
    
    bc_params = np.array(bc_flat).reshape((n_groups, 2))  # shape: (n_groups, 2)
    
    for i in range(n_groups):
        mask = group_indices == i
        if not np.any(mask):
            continue
        x_grp = x[mask]
        B_i = bc_params[i, 0]
        C_i = bc_params[i, 1]
        with np.errstate(divide='ignore', invalid='ignore'):
            res[mask] = D + (A - D) / (1 + (x_grp / C_i) ** B_i)
    return res

def calculate_ec50_global_df(df, x_col_name=None, y_cols_names=None):
    """
    核心计算逻辑：接收 DataFrame，返回结果
    返回: (results, status_msg, removed_count)
    """
    removed_count = 0

    if df is None or df.empty:
        return [], "数据为空", removed_count

    columns = df.columns.tolist()
    if len(columns) < 2:
        return [], "列数不足，至少需要1列浓度和1列响应值", removed_count
        
    if x_col_name is None:
        x_col_name = columns[0]
    if y_cols_names is None:
        y_cols_names = columns[1:]

    if x_col_name not in df.columns:
        return [], f"找不到X轴列: {x_col_name}", removed_count

    all_x = []
    all_y = []
    group_indices = []
    valid_y_cols = []
    x_data_raw = df[x_col_name]
    
    for i, y_col in enumerate(y_cols_names):
        if y_col not in df.columns:
            continue
        y_data_raw = df[y_col]
        temp_df = pd.DataFrame({'x': x_data_raw, 'y': y_data_raw})
        temp_df = temp_df.apply(pd.to_numeric, errors='coerce')
        temp_df.dropna(inplace=True)
        if len(temp_df) < 3:
            continue
        all_x.extend(temp_df['x'].values)
        all_y.extend(temp_df['y'].values)
        group_indices.extend([i] * len(temp_df))
        valid_y_cols.append(y_col)
        
    if not all_x:
        return [], "无有效数值数据", removed_count
        
    all_x = np.array(all_x, dtype=float)
    all_y = np.array(all_y, dtype=float)
    group_indices = np.array(group_indices, dtype=int)
    n_groups = len(valid_y_cols)
    
    if n_groups == 0:
        return [], "无有效数据组", removed_count

    # 过滤 x <= 0
    positive_mask = all_x > 0
    removed_count = int(len(all_x) - np.sum(positive_mask))
    if not np.any(positive_mask):
        return [], "所有浓度数据均非正数，无法进行对数相关拟合", removed_count
        
    all_x = all_x[positive_mask]
    all_y = all_y[positive_mask]
    group_indices = group_indices[positive_mask]

    # 初始参数估计
    global_y_min = np.min(all_y)
    global_y_max = np.max(all_y)
    initial_params = [global_y_min, global_y_max]
    
    for i in range(n_groups):
        mask = group_indices == i
        if not np.any(mask):
            init_b = 1.0
            init_c = 1.0
        else:
            x_grp = all_x[mask]
            y_grp = all_y[mask]
            if len(y_grp) > 1:
                init_b = -1.0 if y_grp[0] > y_grp[-1] else 1.0
            else:
                init_b = 1.0
            init_c = np.median(x_grp) if np.median(x_grp) > 0 else 1.0
        initial_params.extend([init_b, init_c])
        
    initial_params = np.array(initial_params, dtype=float)
    
    # 设置边界
    lower_bounds = [-np.inf, -np.inf] + [-np.inf, 1e-9] * n_groups
    upper_bounds = [np.inf, np.inf] + [np.inf, np.inf] * n_groups

    try:
        # curve_fit 不支持 args=...
        # 用闭包把 group_indices 和 n_groups 固定进去
        fit_model = lambda x, A, D, *bc_flat: global_four_param_logistic_model(
            x, group_indices, n_groups, A, D, *bc_flat
        )

        popt, pcov = curve_fit(
            fit_model,
            all_x,
            all_y,
            p0=initial_params,
            maxfev=10000,
            bounds=(lower_bounds, upper_bounds)
        )
        
        global_A = popt[0]
        global_D = popt[1]
        results = []
        for i, y_col in enumerate(valid_y_cols):
            idx_b = 2 + i * 2
            idx_c = idx_b + 1
            if idx_c >= len(popt):
                continue
            b_val = popt[idx_b]
            c_val = popt[idx_c]
            results.append({
                "Group": y_col,
                "EC50": c_val,
                "Status": "Success",
                "Slope": b_val,
                "Global_A": global_A,
                "Global_D": global_D
            })
            
        return results, "Success", removed_count
        
    except Exception as e:
        return [], f"全局拟合失败: {str(e)}", removed_count

def parse_pasted_text_to_df(text):
    """将粘贴文本解析为 DataFrame，尝试带表头和不带表头"""
    if not text.strip():
        return None
    
    lines = [line for line in text.strip().split('\n') if line.strip()]
    if not lines:
        return None
        
    data_rows = []
    for line in lines:
        line = line.replace('\t', ' ')
        parts = line.split()
        if parts:
            data_rows.append(parts)
            
    if not data_rows:
        return None
        
    csv_str = "\n".join([",".join(row) for row in data_rows])
    
    # 尝试带表头
    try:
        df = pd.read_csv(pd.io.common.StringIO(csv_str), header=0)
        if df.shape[1] >= 2:
            return df
    except Exception:
        pass
        
    # 尝试无表头
    try:
        df = pd.read_csv(pd.io.common.StringIO(csv_str), header=None)
        if df.shape[1] >= 2:
            # 自动生成列名
            df.columns = [f"Col{i}" for i in range(df.shape[1])]
            return df
    except Exception:
        pass
        
    return None

def get_unique_filename(base_path):
    if not os.path.exists(base_path):
        return base_path
    directory, filename = os.path.split(base_path)
    name, ext = os.path.splitext(filename)
    counter = 1
    while True:
        new_filename = f"{name}({counter}){ext}"
        new_path = os.path.join(directory, new_filename)
        if not os.path.exists(new_path):
            return new_path
        counter += 1

def format_results_table(results_list):
    if not results_list:
        return "无有效数据"
    
    col_group_width = 25
    col_ec50_width = 15
    col_status_width = 15
    
    header = f"{'Group':<{col_group_width}} | {'EC50':^{col_ec50_width}} | {'Status':^{col_status_width}}"
    separator = "-" * len(header)
    lines = [header, separator]
    
    for item in results_list:
        group = str(item['Group'])[:col_group_width-1] 
        ec50_val = f"{item['EC50']:.4f}" if item['EC50'] is not None else "N/A"
        status = str(item['Status'])[:col_status_width-1]
        line = f"{group:<{col_group_width}} | {ec50_val:^{col_ec50_width}} | {status:<{col_status_width}}"
        lines.append(line)
        
    return "\n".join(lines)

def process_dataframe_logic(df, text_widget, btn_calculate, source_label="Paste"):
    log_lines = []
    try:
        log_lines.append(f"[1/2] 数据源: {source_label}\n")
        log_lines.append(f"       数据形状: {df.shape[0]} 行 x {df.shape[1]} 列\n")
        
        results, status_msg, removed_count = calculate_ec50_global_df(df)
        
        if removed_count > 0:
            log_lines.append(f"⚠️ 已移除 {removed_count} 个非正浓度数据点（4PL 要求 x > 0）\n")
            
        log_lines.append(f"       开始全局拟合 (共享渐近线)...\n{'-'*30}\n")
        
        if status_msg != "Success":
            log_lines.append(f"拟合出错: {status_msg}\n")
        else:
            if results:
                log_lines.append(f"拟合成功。共享渐近线 A={results[0]['Global_A']:.4f}, D={results[0]['Global_D']:.4f}\n")
            else:
                log_lines.append("拟合完成但未生成有效组结果。\n")

        log_lines.append(f"\n{'-'*30}\n[2/2] 计算完成，生成总结表格:\n\n")
        table_str = format_results_table(results)
        log_lines.append(table_str + "\n\n")
        
        if results:
            result_df = pd.DataFrame(results)
            cols_to_save = ['Group', 'EC50', 'Status']
            save_df = result_df[cols_to_save]
            
            if source_label == "Paste":
                save_dir = os.path.join(os.path.expanduser("~"), "Desktop")
                if not os.path.exists(save_dir):
                    save_dir = os.getcwd()
            else:
                save_dir = os.path.dirname(source_label) if os.path.dirname(source_label) else os.getcwd()
                
            output_filename = "EC50_Results_GlobalFit.csv"
            base_output_path = os.path.join(save_dir, output_filename)
            final_output_path = get_unique_filename(base_output_path)
            
            save_df.to_csv(final_output_path, index=False, encoding='utf-8-sig')
            
            log_lines.append(f"{'='*30}\n")
            log_lines.append(f"结果文件已保存:\n")
            log_lines.append(f"{final_output_path}\n")
            log_lines.append(f"{'='*30}\n")
        else:
            log_lines.append("\n未生成有效结果，无需保存。\n")

    except Exception as e:
        import traceback
        log_lines.append(f"\n[ERROR] 发生未知错误: {str(e)}\n")
        log_lines.append(traceback.format_exc() + "\n")
    finally:
        text_widget.insert(tk.END, "".join(log_lines))
        text_widget.see(tk.END)
        btn_calculate.config(state=tk.NORMAL)

def process_file_logic(file_path, text_widget, btn_calculate):
    log_lines = []
    try:
        log_lines.append(f"[1/3]正在读取文件: {os.path.basename(file_path)}...\n")
        text_widget.insert(tk.END, "".join(log_lines))
        text_widget.see(tk.END)
        text_widget.update()

        df = None
        encodings = ['utf-8', 'gbk', 'latin1', 'utf-8-sig']
        for enc in encodings:
            try:
                df = pd.read_csv(file_path, encoding=enc)
                break
            except UnicodeDecodeError:
                continue
            except Exception:
                break
                
        if df is None or df.empty:
            text_widget.insert(tk.END, "错误：无法读取文件或文件为空。\n")
            btn_calculate.config(state=tk.NORMAL)
            return

        process_dataframe_logic(df, text_widget, btn_calculate, source_label=file_path)

    except Exception as e:
        text_widget.insert(tk.END, f"\n[ERROR] 文件处理错误: {str(e)}\n")
        btn_calculate.config(state=tk.NORMAL)

def start_unified_calculation():
    raw_text = text_paste_input.get("1.0", tk.END).strip()
    file_path = entry_path.get().strip()
    
    btn_calculate.config(state=tk.DISABLED)
    text_output.delete(1.0, tk.END)
    
    def run_logic():
        try:
            if raw_text:
                df = parse_pasted_text_to_df(raw_text)
                if df is None:
                    msg = ("❌ 数据解析失败:\n"
                           "💡 提示：\n"
                           "- 第一行应为列名（如 '浓度 组A 组B'）\n"
                           "- 列之间用空格、Tab 或逗号分隔\n"
                           "- 避免合并单元格或空行穿插\n")
                    text_output.insert(tk.END, msg)
                    btn_calculate.config(state=tk.NORMAL)
                    return
                process_dataframe_logic(df, text_output, btn_calculate, source_label="Paste")
            
            elif file_path and os.path.exists(file_path):
                process_file_logic(file_path, text_output, btn_calculate)
                
            else:
                messagebox.showwarning("提示", "请粘贴数据或选择文件！")
                btn_calculate.config(state=tk.NORMAL)
                
        except Exception as e:
            text_output.insert(tk.END, f"运行错误: {str(e)}\n")
            btn_calculate.config(state=tk.NORMAL)

    thread = threading.Thread(target=run_logic)
    thread.daemon = True
    thread.start()

def select_file():
    file_path = filedialog.askopenfilename(
        title="选择 CSV 数据文件",
        filetypes=[("CSV Files", "*.csv"), ("All Files", "*.*")]
    )
    if file_path:
        entry_path.delete(0, tk.END)
        entry_path.insert(0, file_path)

def paste_from_clipboard():
    try:
        clip_text = pyperclip.paste()
        if clip_text:
            text_paste_input.delete("1.0", tk.END)
            text_paste_input.insert("1.0", clip_text)
    except Exception:
        messagebox.showerror("错误", "无法访问剪贴板，请手动粘贴 (Ctrl+V)。")

def copy_output_to_clipboard():
    try:
        output_text = text_output.get("1.0", tk.END).strip()
        if output_text:
            pyperclip.copy(output_text)
            messagebox.showinfo("成功", "输出内容已复制到剪贴板！")
        else:
            messagebox.showwarning("提示", "输出区域为空，无可复制内容。")
    except Exception as e:
        messagebox.showerror("错误", f"复制失败: {str(e)}")

# --- GUI 构建部分 ---
root = tk.Tk()
root.title("Elisa数据计算工具 (4PL模型 - 全局拟合)")
root.geometry("600x750")

try:
    if getattr(sys, 'frozen', False):
        application_path = os.path.dirname(sys.executable)
    else:
        application_path = os.path.dirname(os.path.abspath(__file__))
    icon_path = resource_path("Ab.ico")
    if os.path.exists(icon_path):
        root.iconbitmap(icon_path)
except Exception as e:
    print(f"图标加载失败 (可忽略): {e}")

# 1. 文件选择区域
frame_top = tk.Frame(root, padx=10, pady=10)
frame_top.pack(fill=tk.X)

lbl_path = tk.Label(frame_top, text="数据文件:", font=("Arial", 10))
lbl_path.pack(side=tk.LEFT)

entry_path = tk.Entry(frame_top, width=60)
entry_path.pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)

btn_browse = tk.Button(frame_top, text="浏览...", command=select_file, width=8)
btn_browse.pack(side=tk.LEFT, padx=5)

# 2. 粘贴数据区域
frame_paste = tk.LabelFrame(root, text="或直接粘贴数据 (适用于加密/无法读取的文件)", padx=10, pady=10)
frame_paste.pack(fill=tk.BOTH, expand=True, padx=10, pady=5)

lbl_paste_hint = tk.Label(frame_paste, text="请将 Excel 或文本中的数据复制并粘贴到下方 (第一行为表头，如: 浓度, 组别1...):", anchor=tk.W, fg="#666")
lbl_paste_hint.pack(anchor=tk.W)

text_paste_input = scrolledtext.ScrolledText(frame_paste, wrap=tk.NONE, font=("Consolas", 9), height=8)
text_paste_input.pack(fill=tk.BOTH, expand=True, pady=5)

frame_btn_paste = tk.Frame(frame_paste)
frame_btn_paste.pack(fill=tk.X)

btn_paste_clip = tk.Button(frame_btn_paste, text="从剪贴板粘贴", command=paste_from_clipboard, width=15)
btn_paste_clip.pack(side=tk.LEFT, padx=5)

# 3. 统一操作按钮区域
frame_btn_main = tk.Frame(root, padx=10, pady=5)
frame_btn_main.pack(fill=tk.X)

btn_calculate = tk.Button(frame_btn_main, text="开始计算", command=start_unified_calculation, 
                          bg="#E3F2FD", fg="#0D47A1", font=("Arial", 12, "bold"), height=2, relief=tk.RAISED)
btn_calculate.pack(pady=5, fill=tk.X)

# 4. 结果显示区域
frame_result = tk.LabelFrame(root, text="运行日志与结果汇总", padx=10, pady=10)
frame_result.pack(fill=tk.BOTH, expand=True, padx=10, pady=5)

text_output = scrolledtext.ScrolledText(frame_result, wrap=tk.NONE, font=("Consolas", 10))
text_output.pack(fill=tk.BOTH, expand=True)

btn_copy_output = tk.Button(frame_result, text="复制输出内容", command=copy_output_to_clipboard, width=15)
btn_copy_output.pack(side=tk.BOTTOM, pady=5)

root.mainloop()