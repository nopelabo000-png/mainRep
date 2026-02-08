FROM runpod/worker-comfyui:5.7.1-base

WORKDIR /comfyui/custom_nodes

# ControlNetノードをインストール
RUN git clone https://github.com/Kosinkadink/ComfyUI-Advanced-ControlNet && \
    git clone https://github.com/Fannovel16/comfyui_controlnet_aux

# IP-Adapter Plusをインストール（キャラクター一貫性保持用）
RUN git clone https://github.com/cubiq/ComfyUI_IPAdapter_plus

# 依存関係インストール
RUN pip install --no-cache-dir \
    -r comfyui_controlnet_aux/requirements.txt && \
    pip install --no-cache-dir insightface onnxruntime-gpu

# ★ デバッグ: ファイル存在確認 + ソースコード内のノード名確認
RUN echo "=== IPAdapter files ===" && \
    ls -la /comfyui/custom_nodes/ComfyUI_IPAdapter_plus/*.py && \
    echo "" && \
    echo "=== NODE_CLASS_MAPPINGS in source ===" && \
    grep -n "NODE_CLASS_MAPPINGS\|IPAdapterUnifiedLoader\|IPAdapterModelLoader\|IPAdapterApply\|'IPAdapter'" \
      /comfyui/custom_nodes/ComfyUI_IPAdapter_plus/__init__.py | head -30 && \
    echo "" && \
    echo "=== All registered node names ===" && \
    python3 -c "exec(open('/comfyui/custom_nodes/ComfyUI_IPAdapter_plus/__init__.py').read()); print(list(NODE_CLASS_MAPPINGS.keys()))" 2>&1 || \
    echo "DIRECT IMPORT FAILED - trying grep fallback" && \
    grep -rn "NODE_CLASS_MAPPINGS" /comfyui/custom_nodes/ComfyUI_IPAdapter_plus/ --include="*.py" | head -20

# 起動スクリプト追加
COPY start.sh /start.sh
RUN chmod +x /start.sh

WORKDIR /comfyui

# エントリーポイント
CMD ["/start.sh"]
