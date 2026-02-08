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

# 起動スクリプト追加
COPY start.sh /start.sh
RUN chmod +x /start.sh

WORKDIR /comfyui

# エントリーポイント
CMD ["/start.sh"]
