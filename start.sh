#!/bin/bash
set -e

VOLUME="/workspace"

echo "=== ComfyUI Startup Script ==="
echo "Checking Network Volume at $VOLUME..."

# Network Volumeが存在する場合のみリンク作成
if [ -d "$VOLUME/models" ]; then
    echo "Network Volume found. Linking directories..."

    # 既存のディレクトリをバックアップ・削除してリンク
    for dir in checkpoints controlnet loras vae; do
        if [ -d "/comfyui/models/$dir" ] && [ ! -L "/comfyui/models/$dir" ]; then
            rm -rf /comfyui/models/$dir
        fi
        mkdir -p $VOLUME/models/$dir
        ln -sfn $VOLUME/models/$dir /comfyui/models/$dir
        echo "  Linked: /comfyui/models/$dir -> $VOLUME/models/$dir"
    done

    # ★ IP-Adapter モデル: /comfyui/models/ipadapter に確実に配置
    # IPAdapter Plusは folder_paths.get_folder_paths("ipadapter") から検索
    # Docker imageの extra_model_paths.yaml に /runpod-volume/ が設定されている場合もカバー
    mkdir -p $VOLUME/models/ipadapter
    if [ -d "/comfyui/models/ipadapter" ] && [ ! -L "/comfyui/models/ipadapter" ]; then
        rm -rf /comfyui/models/ipadapter
    fi
    ln -sfn $VOLUME/models/ipadapter /comfyui/models/ipadapter
    echo "  Linked: /comfyui/models/ipadapter -> $VOLUME/models/ipadapter"

    # ★ /runpod-volume/models/ipadapter にもシンボリックリンク(Docker imageのextra_model_paths対応)
    if [ -d "/runpod-volume/models" ]; then
        mkdir -p /runpod-volume/models/ipadapter
        # ファイルが /workspace にあるなら /runpod-volume にコピーまたはリンク
        if [ -f "$VOLUME/models/ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors" ]; then
            if [ ! -f "/runpod-volume/models/ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors" ]; then
                ln -sf $VOLUME/models/ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors /runpod-volume/models/ipadapter/
                echo "  Also linked IPAdapter model to /runpod-volume/models/ipadapter/"
            fi
        fi
    fi

    # ★ CLIP Vision: 同様に両パスに配置
    mkdir -p $VOLUME/models/clip_vision
    if [ -d "/comfyui/models/clip_vision" ] && [ ! -L "/comfyui/models/clip_vision" ]; then
        rm -rf /comfyui/models/clip_vision
    fi
    ln -sfn $VOLUME/models/clip_vision /comfyui/models/clip_vision
    echo "  Linked: /comfyui/models/clip_vision -> $VOLUME/models/clip_vision"

    # 入出力ディレクトリ
    mkdir -p $VOLUME/input $VOLUME/output

    if [ -d "/comfyui/input" ] && [ ! -L "/comfyui/input" ]; then
        rm -rf /comfyui/input
    fi
    if [ -d "/comfyui/output" ] && [ ! -L "/comfyui/output" ]; then
        rm -rf /comfyui/output
    fi

    ln -sfn $VOLUME/input /comfyui/input
    ln -sfn $VOLUME/output /comfyui/output
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

    # ★ シンボリックリンクの確認
    echo ""
    echo "=== Symlink Verification ==="
    ls -la /comfyui/models/ipadapter 2>/dev/null || echo "  ipadapter symlink MISSING"
    ls -la /comfyui/models/clip_vision 2>/dev/null || echo "  clip_vision symlink MISSING"
    echo ""
    echo "=== /runpod-volume check ==="
    ls -lh /runpod-volume/models/ipadapter/ 2>/dev/null || echo "  /runpod-volume/models/ipadapter/ not found"
    ls -lh /runpod-volume/models/clip_vision/ 2>/dev/null || echo "  /runpod-volume/models/clip_vision/ not found"

    # ★ extra_model_paths.yaml の確認
    echo ""
    echo "=== ComfyUI extra_model_paths.yaml ==="
    cat /comfyui/extra_model_paths.yaml 2>/dev/null || echo "  (not found)"

    # ========================================
    # ★ モデル自動ダウンロード（初回のみ）
    # Network Volumeに保存されるため、以降のコールドスタートでは不要
    # ========================================
    echo ""
    echo "=== Auto-download Missing Models ==="

    # IP-Adapter Plus SDXL (ViT-H) - キャラクター一貫性保持用
    if [ ! -f "$VOLUME/models/ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors" ]; then
        echo "Downloading IP-Adapter Plus SDXL model (~100MB)..."
        wget -q --show-progress -O "$VOLUME/models/ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors" \
            "https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors" \
            && echo "  ✅ IP-Adapter model downloaded" \
            || echo "  ❌ IP-Adapter model download failed"
    else
        echo "  ✅ IP-Adapter model already exists"
    fi

    # CLIP Vision ViT-H - IP-Adapterが参照画像をエンコードするために必要
    if [ ! -f "$VOLUME/models/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors" ]; then
        echo "Downloading CLIP Vision ViT-H model (~3.9GB)..."
        wget -q --show-progress -O "$VOLUME/models/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors" \
            "https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors" \
            && echo "  ✅ CLIP Vision model downloaded" \
            || echo "  ❌ CLIP Vision model download failed"
    else
        echo "  ✅ CLIP Vision model already exists"
    fi
else
    echo "Warning: Network Volume not found at $VOLUME"
    echo "Running with container-local models only."
fi

echo ""
echo "=== Starting ComfyUI Server ==="

# ★ ComfyUIサーバーをバックグラウンドで起動
# 注意: tee をパイプで使うとcurlのhealth checkが失敗するため、リダイレクトのみ使用
cd /comfyui
python -u main.py --listen 127.0.0.1 --port 8188 > /tmp/comfyui_startup.log 2>&1 &
COMFYUI_PID=$!
echo "ComfyUI started with PID: $COMFYUI_PID"

# ★ ComfyUIサーバーが起動するまで待機（最大5分 = 150回 x 2秒）
echo "Waiting for ComfyUI server to be ready..."
MAX_ATTEMPTS=150
ATTEMPT=0
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8188/ 2>/dev/null | grep -q "200"; then
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

# ★ ノード登録確認（IPAdapter）
echo ""
echo "=== Post-startup: Node Registration Check ==="
OBJECT_INFO=$(curl -s http://127.0.0.1:8188/object_info 2>/dev/null || echo "{}")

for node_name in IPAdapterUnifiedLoader IPAdapter CLIPVisionLoader; do
    if echo "$OBJECT_INFO" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if '$node_name' in d else 1)" 2>/dev/null; then
        echo "  ✅ $node_name: REGISTERED"
    else
        echo "  ❌ $node_name: NOT FOUND"
    fi
done

# ★ IPAdapterモデル検索パスの確認
echo ""
echo "=== IPAdapter Model Search Paths ==="
if echo "$OBJECT_INFO" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if 'IPAdapterModelLoader' in d:
    node = d['IPAdapterModelLoader']
    if 'input' in node and 'required' in node['input']:
        if 'ipadapter_file' in node['input']['required']:
            models = node['input']['required']['ipadapter_file'][0]
            print('Available IPAdapter models:', models)
        else:
            print('No ipadapter_file input found')
    else:
        print('No input/required found')
else:
    print('IPAdapterModelLoader not registered')
" 2>/dev/null; then
    true
else
    echo "  Could not query IPAdapter model paths"
fi

echo ""
echo "=== Starting RunPod Worker ==="

# 既存のrunpod workerエントリーポイントを実行
exec python -u /handler.py
