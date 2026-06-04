import re
import os

def check_brackets(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    clean_lines = []
    in_block = False
    for line_num, line in enumerate(lines, 1):
        original_line = line
        if in_block:
            if '*/' in line:
                line = line.split('*/', 1)[1]
                in_block = False
            else:
                line = ''
        if not in_block:
            if '/*' in line:
                if '*/' in line:
                    line = re.sub(r'/\*.*?\*/', '', line)
                else:
                    line = line.split('/*', 1)[0]
                    in_block = True
            if '//' in line:
                line = line.split('//', 1)[0]
        
        # Now let's strip strings from this line
        line = re.sub(r"'[^'\\]*(?:\\.[^'\\]*)*'", "''", line)
        line = re.sub(r'"[^"\\]*(?:\\.[^"\\]*)*"', '""', line)
        line = re.sub(r'`[^`\\]*(?:\\.[^`\\]*)*`', '``', line)
        
        clean_lines.append((line, line_num, original_line))
        
    stack = []
    has_errors = False
    for line, line_num, original_line in clean_lines:
        for col_num, char in enumerate(line, 1):
            if char in '({[':
                stack.append((char, line_num, col_num))
            elif char in ')}]':
                if not stack:
                    print(f"[{filename}] Extra closing '{char}' at line {line_num}:{col_num}: {original_line.strip()}")
                    has_errors = True
                    continue
                top, top_line, top_col = stack.pop()
                if (char == ')' and top != '(') or \
                   (char == '}' and top != '{') or \
                   (char == ']' and top != '['):
                    print(f"[{filename}] Mismatched: opened '{top}' at {top_line}:{top_col}, closed '{char}' at {line_num}:{col_num}: {original_line.strip()}")
                    has_errors = True
                    
    while stack:
        top, top_line, top_col = stack.pop()
        print(f"[{filename}] Unclosed '{top}' opened at line {top_line}:{top_col}")
        has_errors = True
        
    return not has_errors

for root, dirs, files in os.walk('static/js'):
    for file in files:
        if file.endswith('.js'):
            filepath = os.path.join(root, file)
            check_brackets(filepath)
