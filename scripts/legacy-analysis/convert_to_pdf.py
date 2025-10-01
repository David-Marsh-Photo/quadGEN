#!/usr/bin/env python3

import re
from pathlib import Path

def markdown_to_html(md_content):
    """Convert basic markdown to HTML"""
    html = md_content
    
    # Headers
    html = re.sub(r'^# (.*?)$', r'<h1>\1</h1>', html, flags=re.MULTILINE)
    html = re.sub(r'^## (.*?)$', r'<h2>\1</h2>', html, flags=re.MULTILINE)
    html = re.sub(r'^### (.*?)$', r'<h3>\1</h3>', html, flags=re.MULTILINE)
    
    # Bold text
    html = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', html)
    
    # Code blocks
    html = re.sub(r'`([^`]+)`', r'<code>\1</code>', html)
    
    # Lists - handle bullet points
    lines = html.split('\n')
    in_list = False
    result_lines = []
    
    for line in lines:
        if line.strip().startswith('- '):
            if not in_list:
                result_lines.append('<ul>')
                in_list = True
            content = line.strip()[2:]  # Remove '- '
            result_lines.append(f'<li>{content}</li>')
        elif line.strip().startswith(('1. ', '2. ', '3. ', '4. ', '5. ', '6. ', '7. ', '8. ', '9. ')):
            if not in_list:
                result_lines.append('<ol>')
                in_list = 'ol'
            content = re.sub(r'^\d+\. ', '', line.strip())
            result_lines.append(f'<li>{content}</li>')
        else:
            if in_list:
                if in_list == 'ol':
                    result_lines.append('</ol>')
                else:
                    result_lines.append('</ul>')
                in_list = False
            
            if line.strip() == '':
                result_lines.append('<br>')
            elif line.strip() == '---':
                result_lines.append('<hr>')
            else:
                result_lines.append(f'<p>{line}</p>')
    
    if in_list:
        if in_list == 'ol':
            result_lines.append('</ol>')
        else:
            result_lines.append('</ul>')
    
    return '\n'.join(result_lines)

def create_html_report():
    # Read markdown file
    md_path = Path('/Users/marshmonkey/Library/CloudStorage/Dropbox/Photography/quadGEN/POPS_vs_quadGEN_Comparison_Report.md')
    
    with open(md_path, 'r', encoding='utf-8') as f:
        md_content = f.read()
    
    # Convert to HTML
    html_body = markdown_to_html(md_content)
    
    # CSS styling
    css = """
    <style>
    @page { 
        margin: 1in; 
        size: letter;
    }
    
    body { 
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
        line-height: 1.6; 
        color: #333;
        font-size: 11pt;
    }
    
    h1 { 
        color: #2c3e50; 
        border-bottom: 3px solid #3498db; 
        padding-bottom: 10px;
        page-break-after: avoid;
        font-size: 18pt;
        margin-top: 20pt;
        margin-bottom: 12pt;
    }
    
    h2 { 
        color: #34495e; 
        margin-top: 18pt; 
        margin-bottom: 8pt;
        border-bottom: 1px solid #bdc3c7;
        padding-bottom: 5px;
        page-break-after: avoid;
        font-size: 14pt;
    }
    
    h3 { 
        color: #5d6d7e; 
        margin-top: 14pt;
        margin-bottom: 6pt;
        page-break-after: avoid;
        font-size: 12pt;
    }
    
    p { 
        margin: 8pt 0;
        text-align: justify;
    }
    
    strong { 
        color: #2c3e50; 
        font-weight: 600; 
    }
    
    code { 
        background-color: #f8f9fa; 
        padding: 2px 6px; 
        border-radius: 4px; 
        font-family: 'SF Mono', Consolas, 'Liberation Mono', monospace;
        font-size: 9pt;
    }
    
    ul, ol { 
        margin: 8pt 0; 
        padding-left: 20pt;
    }
    
    li { 
        margin: 4pt 0; 
    }
    
    hr { 
        border: none; 
        border-top: 1px solid #bdc3c7; 
        margin: 16pt 0; 
    }
    
    .winner {
        background-color: #d4edda;
        padding: 8pt;
        border-radius: 4px;
        margin: 8pt 0;
    }
    
    /* Table styling if any tables exist */
    table {
        border-collapse: collapse;
        width: 100%;
        margin: 8pt 0;
        font-size: 10pt;
    }
    
    th, td {
        border: 1px solid #ddd;
        padding: 6pt;
        text-align: left;
    }
    
    th {
        background-color: #f8f9fa;
        font-weight: 600;
    }
    </style>
    """
    
    # Complete HTML document
    html_content = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>POPS Profiler vs quadGEN Comparison Report</title>
    {css}
</head>
<body>
{html_body}
</body>
</html>"""
    
    # Save HTML file
    html_path = md_path.with_suffix('.html')
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    print(f"HTML file created at: {html_path}")
    return html_path

if __name__ == "__main__":
    create_html_report()