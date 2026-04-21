import json
import os

def read_file(path):
    with open(path, 'r') as f:
        return f.read()

project_id = "kxfhxrdrlvnvtzdeuvwb"
function_name = "generate-briefing"
index_content = read_file("/home/ubuntu/bsc-v3/supabase/functions/generate-briefing/index.ts")
cors_content = read_file("/home/ubuntu/bsc-v3/supabase/functions/_shared/cors.ts")

payload = {
    "project_id": project_id,
    "name": function_name,
    "entrypoint_path": "index.ts",
    "verify_jwt": True,
    "files": [
        {"name": "index.ts", "content": index_content},
        {"name": "../_shared/cors.ts", "content": cors_content}
    ]
}

print(json.dumps(payload))
