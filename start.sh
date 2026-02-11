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
        # ★ ディレクトリが存在しない場合は作成してからリンク
        mkdir -p $VOLUME/models/$dir
        ln -sf $VOLUME/models/$dir /comfyui/models/$dir
        echo "  Linked: /comfyui/models/$dir -> $VOLUME/models/$dir"
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
    ls -lh $VOLUME/models/checkpoints/ 2>/dev/null || echo "  (none)"
    echo "ControlNet:"
    ls -lh $VOLUME/models/controlnet/ 2>/dev/null || echo "  (none)"
    echo "LoRAs:"
    ls -lh $VOLUME/models/loras/ 2>/dev/null || echo "  (none)"
    echo "IP-Adapter:"
    ls -lh $VOLUME/models/ipadapter/ 2>/dev/null || echo "  (none)"
    echo "CLIP Vision:"
    ls -lh $VOLUME/models/clip_vision/ 2>/dev/null || echo "  (none)"
else
    echo "Warning: Network Volume not found at $VOLUME"
    echo "Running with container-local models only."
fi

echo ""
echo "=== Starting ComfyUI Server ==="

# ComfyUIサーバーをバックグラウンドで起動（ログをファイルに保存）
cd /comfyui
python -u main.py --listen 127.0.0.1 --port 8188 2>&1 | tee /tmp/comfyui_startup.log &
COMFYUI_PID=$!
echo "ComfyUI started with PID: $COMFYUI_PID"

# ★ ComfyUIサーバーが起動するまで待機（最大5分 = 150回 x 2秒）
echo "Waiting for ComfyUI server to be ready..."
MAX_ATTEMPTS=150
ATTEMPT=0
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    if curl -s http://127.0.0.1:8188/ > /dev/null 2>&1; then
        echo "ComfyUI server is ready! (after ${ATTEMPT} attempts, ~$((ATTEMPT * 2))s)"
        break
    fi
    ATTEMPT=$((ATTEMPT + 1))
    if [ $((ATTEMPT % 10)) -eq 0 ]; then
        echo "  Attempt $ATTEMPT/$MAX_ATTEMPTS - waiting..."
    fi
    sleep 2
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
    echo "ERROR: ComfyUI server failed to start within $((MAX_ATTEMPTS * 2)) seconds"
    echo "=== ComfyUI Startup Log (last 50 lines) ==="
    tail -50 /tmp/comfyui_startup.log 2>/dev/null || echo "  (no log)"
    echo "Proceeding anyway, but jobs may fail..."
fi

# ★ 追加待機: サーバーがレスポンスを返しても、カスタムノードのロード完了を確認
echo ""
echo "=== Post-startup: Waiting for Custom Nodes ==="
echo "Checking IPAdapter node registration..."
NODE_CHECK_ATTEMPTS=0
NODE_CHECK_MAX=30
IPADAPTER_READY=false

while [ $NODE_CHECK_ATTEMPTS -lt $NODE_CHECK_MAX ]; do
    OBJECT_INFO=$(curl -s http://127.0.0.1:8188/object_info 2>/dev/null || echo "{}")
    
    # IPAdapterUnifiedLoader の存在を確認
    if echo "$OBJECT_INFO" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if 'IPAdapterUnifiedLoader' in d else 1)" 2>/dev/null; then
        echo "  ✅ IPAdapterUnifiedLoader: REGISTERED"
        IPADAPTER_READY=true
        break
    fi
    
    NODE_CHECK_ATTEMPTS=$((NODE_CHECK_ATTEMPTS + 1))
    if [ $((NODE_CHECK_ATTEMPTS % 5)) -eq 0 ]; then
        echo "  Waiting for nodes... ($NODE_CHECK_ATTEMPTS/$NODE_CHECK_MAX)"
    fi
    sleep 3
done

if [ "$IPADAPTER_READY" = true ]; then
    echo ""
    echo "=== All IPAdapter Nodes Check ==="
    for node_name in IPAdapterUnifiedLoader IPAdapter IPAdapterModelLoader IPAdapterApply; do
        if echo "$OBJECT_INFO" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if '$node_name' in d else 1)" 2>/dev/null; then
            echo "  ✅ $node_name: REGISTERED"
        else
            echo "  ❌ $node_name: NOT FOUND"
        fi
    done
else
    echo "  ⚠️ IPAdapter nodes NOT registered after $((NODE_CHECK_MAX * 3))s"
    echo "=== ComfyUI Startup Log (errors) ==="
    grep -i "error\|fail\|exception\|import" /tmp/comfyui_startup.log 2>/dev/null | tail -20 || echo "  (no errors found)"
fi

echo ""
echo "=== Starting RunPod Worker ==="

# 既存のrunpod workerエントリーポイントを実行
exec python -u /handler.py
