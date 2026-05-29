import os
import re

TEST_DIR = 'apps/api/test'

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    pattern = r'(app\.jwt\.sign\(\{)([^}]*?)(role:\s*[\'"]?([A-Z]+)[\'"]?)([^}]*?)(\})'
    
    def replacer(match):
        prefix = match.group(1)
        before_role = match.group(2)
        role_part = match.group(3)
        after_role = match.group(5)
        suffix = match.group(6)
        
        if 'branchIds:' in before_role or 'branchIds:' in after_role:
            return match.group(0)
            
        patch = ", branchIds: ['00000000-0000-0000-0000-000000000000'], permissions: ['sales:create', 'sales:void', 'returns:create', 'inventory:adjust', 'inventory:transfer', 'inventory:receive', 'reports:view', 'cash:reconcile', 'cash:audit', 'settings:manage']"
        
        return f"{prefix}{before_role}{role_part}{after_role}{patch}{suffix}"
        
    new_content = re.sub(pattern, replacer, content, flags=re.DOTALL)
    
    if new_content != content:
        with open(filepath, 'w') as f:
            f.write(new_content)
        print(f"Patched {filepath}")

for root, _, files in os.walk(TEST_DIR):
    for f in files:
        if f.endswith('.test.ts'):
            process_file(os.path.join(root, f))
