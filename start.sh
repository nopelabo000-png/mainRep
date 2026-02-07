#!/bin/bash
set -e

VOLUME="/runpod-volume"

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
else
    echo "Warning: Network Volume not found at $VOLUME"
    echo "Running with container-local models only."
fi

echo ""
echo "=== Starting RunPod Worker ==="

# 既存のrunpod workerエントリーポイントを実行
exec python -u /handler.py
