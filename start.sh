#!/bin/bash
set -e

VOLUME="/workspace"

echo "=== ComfyUI Startup Script ==="
echo "Checking Network Volume at $VOLUME..."

# Network Volumeが存在する場合のみリンク作成
if [ -d "$VOLUME/models" ]; then
    echo "Network Volume found. Linking directories..."
    
    # 既存のディレクトリをバックアップ・削除してリンク
    for dir in checkpoints controlnet loras vae ipadapter clip_vision; do
        if [ -d "/comfyui/models/$dir" ] && [ ! -L "/comfyui/models/$dir" ]; then
            rm -rf /comfyui/models/$dir
        fi
        if [ -d "$VOLUME/models/$dir" ]; then
            ln -sf $VOLUME/models/$dir /comfyui/models/$dir
            echo "  Linked: /comfyui/models/$dir -> $VOLUME/models/$dir"
        fi
    done
    
    # 入出力ディレクトリ
    mkdir -p $VOLUME/input $VOLUME/output
    
    if [ -d "/comfyui/input" ] && [ ! -L "/comfyui/input" ]; then
        rm -rf /comfyui/input
    fi
    if [ -d "/comfyui/output" ] && [ ! -L "/comfyui/output" ]; then
        rm -rf /comfyui/output
    fi
    
    ln -sf $VOLUME/input /comfyui/input
    ln -sf $VOLUME/output /comfyui/output
    echo "  Linked: input and output directories"
    
    echo "Network Volume linked successfully."
    
    # モデル確認
    echo ""
    echo "=== Available Models ==="
    echo "Checkpoints:"
    ls -la $VOLUME/models/checkpoints/ 2>/dev/null || echo "  (none)"
    echo "ControlNet:"
    ls -la $VOLUME/models/controlnet/ 2>/dev/null || echo "  (none)"
    echo "LoRAs:"
    ls -la $VOLUME/models/loras/ 2>/dev/null || echo "  (none)"
    echo "IP-Adapter:"
    ls -la $VOLUME/models/ipadapter/ 2>/dev/null || echo "  (none)"
    echo "CLIP Vision:"
    ls -la $VOLUME/models/clip_vision/ 2>/dev/null || echo "  (none)"
else
    echo "Warning: Network Volume not found at $VOLUME"
    echo "Running with container-local models only."
fi

echo ""
echo "=== Pre-flight: Custom Nodes Check ==="
echo "Installed custom nodes:"
ls -la /comfyui/custom_nodes/ 2>/dev/null
echo ""
echo "IPAdapter Plus files:"
ls -la /comfyui/custom_nodes/ComfyUI_IPAdapter_plus/*.py 2>/dev/null || echo "  NOT FOUND!"
echo ""

# ★ IPAdapter Plusのimportテスト（サイレント失敗を検出）
echo "=== Testing IPAdapter Plus import ==="
cd /comfyui
python3 -c "
import sys, traceback
sys.path.insert(0, '.')
try:
    # ComfyUIのノード登録の仕組みを模倣
    import importlib
    spec = importlib.util.spec_from_file_location(
        'ComfyUI_IPAdapter_plus',
        'custom_nodes/ComfyUI_IPAdapter_plus/__init__.py'
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if hasattr(mod, 'NODE_CLASS_MAPPINGS'):
        names = list(mod.NODE_CLASS_MAPPINGS.keys())
        print('SUCCESS: Registered nodes:', names)
    else:
        print('WARNING: No NODE_CLASS_MAPPINGS found')
except Exception as e:
    print('IMPORT FAILED:', e)
    traceback.print_exc()
" 2>&1 || echo "Python test script itself failed"

echo ""
echo "=== Starting ComfyUI Server ==="

# ComfyUIサーバーをバックグラウンドで起動（★ログをファイルに保存）
cd /comfyui
python -u main.py --listen 127.0.0.1 --port 8188 2>&1 | tee /tmp/comfyui_startup.log &
COMFYUI_PID=$!
echo "ComfyUI started with PID: $COMFYUI_PID"

# ComfyUIサーバーが起動するまで待機
echo "Waiting for ComfyUI server to be ready..."
MAX_ATTEMPTS=60
ATTEMPT=0
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    if curl -s http://127.0.0.1:8188/ > /dev/null 2>&1; then
        echo "ComfyUI server is ready!"
        break
    fi
    ATTEMPT=$((ATTEMPT + 1))
    echo "  Attempt $ATTEMPT/$MAX_ATTEMPTS - waiting..."
    sleep 2
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
    echo "Warning: ComfyUI server may not be fully ready"
fi

# ★ 起動後: カスタムノードのロード状況をAPI経由で確認
echo ""
echo "=== Post-startup: Node Registration Check ==="
echo "Checking IPAdapter nodes via ComfyUI API..."
OBJECT_INFO=$(curl -s http://127.0.0.1:8188/object_info 2>/dev/null || echo "{}")
for node_name in IPAdapterUnifiedLoader IPAdapter IPAdapterModelLoader IPAdapterApply IPAdapterSimple; do
    if echo "$OBJECT_INFO" | python3 -c "import sys,json; d=json.load(sys.stdin); print('$node_name' in d)" 2>/dev/null | grep -q True; then
        echo "  ✅ $node_name: REGISTERED"
    else
        echo "  ❌ $node_name: NOT FOUND"
    fi
done

# ★ ComfyUI起動ログからエラーを抽出
echo ""
echo "=== ComfyUI Startup Errors (if any) ==="
grep -i "error\|fail\|cannot\|exception\|IPAdapter\|ipadapter" /tmp/comfyui_startup.log 2>/dev/null || echo "  (no errors found)"

echo ""
echo "=== Starting RunPod Worker ==="

# 既存のrunpod workerエントリーポイントを実行
exec python -u /handler.py
