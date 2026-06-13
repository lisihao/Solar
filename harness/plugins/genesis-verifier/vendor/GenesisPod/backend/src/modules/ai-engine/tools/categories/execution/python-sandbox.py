#!/usr/bin/env python3
"""
Python Sandbox Executor
安全的 Python 代码执行环境
"""

import sys
import json
import io
import time
import traceback
from contextlib import redirect_stdout, redirect_stderr
import base64

# 尝试导入 matplotlib（可选）
try:
    import matplotlib
    matplotlib.use('Agg')  # 非交互式后端
    import matplotlib.pyplot as plt
    MATPLOTLIB_AVAILABLE = True
except ImportError:
    MATPLOTLIB_AVAILABLE = False


def capture_figures():
    """捕获所有 matplotlib 图表"""
    if not MATPLOTLIB_AVAILABLE:
        return []

    figures = []
    for fig_num in plt.get_fignums():
        fig = plt.figure(fig_num)

        # 保存到字节流
        buf = io.BytesIO()
        fig.savefig(buf, format='png', bbox_inches='tight', dpi=100)
        buf.seek(0)

        # Base64 编码
        img_data = base64.b64encode(buf.read()).decode('utf-8')

        figures.append({
            'type': 'image',
            'format': 'png',
            'data': img_data
        })

        buf.close()

    # 清理所有图表
    plt.close('all')

    return figures


def execute_code(code: str, context_vars: dict) -> dict:
    """
    执行 Python 代码并返回结果

    Args:
        code: 要执行的 Python 代码
        context_vars: 上下文变量

    Returns:
        包含执行结果的字典
    """
    start_time = time.time()

    # 创建执行命名空间
    namespace = {
        '__builtins__': __builtins__,
        **context_vars
    }

    # 捕获标准输出和标准错误
    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()

    result = {
        'success': False,
        'stdout': '',
        'stderr': '',
        'returnValue': None,
        'figures': [],
        'executionTime': 0
    }

    try:
        # 重定向输出
        with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
            # 编译代码
            compiled_code = compile(code, '<string>', 'exec')

            # 执行代码
            exec(compiled_code, namespace)

            # 尝试获取返回值（查找最后一个表达式的值）
            # 如果代码中有 _result 变量，使用它作为返回值
            if '_result' in namespace:
                result['returnValue'] = namespace['_result']
            elif '_' in namespace:
                result['returnValue'] = namespace['_']

        # 捕获图表
        if MATPLOTLIB_AVAILABLE:
            result['figures'] = capture_figures()

        result['success'] = True
        result['stdout'] = stdout_capture.getvalue()
        result['stderr'] = stderr_capture.getvalue()

    except Exception as e:
        result['success'] = False
        result['stderr'] = f"{type(e).__name__}: {str(e)}\n{traceback.format_exc()}"
        result['stdout'] = stdout_capture.getvalue()

    finally:
        result['executionTime'] = (time.time() - start_time) * 1000  # 转换为毫秒

    return result


def serialize_value(value):
    """将 Python 值序列化为 JSON 兼容格式"""
    if value is None:
        return None

    # 基本类型
    if isinstance(value, (bool, int, float, str)):
        return value

    # 列表
    if isinstance(value, (list, tuple)):
        return [serialize_value(v) for v in value]

    # 字典
    if isinstance(value, dict):
        return {k: serialize_value(v) for k, v in value.items()}

    # numpy 数组
    try:
        import numpy as np
        if isinstance(value, np.ndarray):
            return value.tolist()
    except ImportError:
        pass

    # pandas DataFrame
    try:
        import pandas as pd
        if isinstance(value, pd.DataFrame):
            return value.to_dict('records')
        if isinstance(value, pd.Series):
            return value.to_list()
    except ImportError:
        pass

    # 其他对象，转换为字符串
    return str(value)


def main():
    """主函数"""
    try:
        # 读取输入
        input_data = json.loads(sys.stdin.read())

        code = input_data.get('code', '')
        context_vars = input_data.get('context', {}).get('variables', {})

        # 执行代码
        result = execute_code(code, context_vars)

        # 序列化返回值
        if result['returnValue'] is not None:
            result['returnValue'] = serialize_value(result['returnValue'])

        # 输出结果
        print(json.dumps(result, ensure_ascii=False))

    except Exception as e:
        # 处理 JSON 解析错误等
        error_result = {
            'success': False,
            'stdout': '',
            'stderr': f"Sandbox Error: {str(e)}\n{traceback.format_exc()}",
            'returnValue': None,
            'figures': [],
            'executionTime': 0
        }
        print(json.dumps(error_result, ensure_ascii=False))
        sys.exit(1)


if __name__ == '__main__':
    main()
