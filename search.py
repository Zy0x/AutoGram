import os

def search_dir(d, p):
    for root, _, files in os.walk(d):
        if 'node_modules' in root or '.git' in root or 'venv' in root:
            continue
        for f in files:
            path = os.path.join(root, f)
            try:
                with open(path, 'r', encoding='utf-8') as file:
                    for i, line in enumerate(file):
                        if p.lower() in line.lower():
                            print(f"{path}:{i+1}: {line.strip()}")
            except:
                pass

search_dir(r'F:\AutoGram\AutoGram App', 'Fast Forward')
