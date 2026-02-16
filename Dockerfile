FROM runpod/worker-comfyui:5.7.1-base

WORKDIR /comfyui/custom_nodes

# ControlNetノードをインストール
RUN git clone https://github.com/Kosinkadink/ComfyUI-Advanced-ControlNet && \
    git clone https://github.com/Fannovel16/comfyui_controlnet_aux

# IP-Adapter Plusをインストール（キャラクター一貫性保持用）
RUN git clone https://github.com/cubiq/ComfyUI_IPAdapter_plus

# 依存関係インストール
RUN pip install --no-cache-dir \
    -r comfyui_controlnet_aux/requirements.txt

# ★ IP-Adapter & CLIP Visionモデルをプリダウンロード
# Dockerイメージに焼き込むことで、コールドスタート時のダウンロード待ちを回避
RUN mkdir -p /comfyui/models/ipadapter && \
    wget -q -O /comfyui/models/ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors \
    "https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors"

RUN mkdir -p /comfyui/models/clip_vision && \
    wget -q -O /comfyui/models/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors \
    "https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors"

# 起動スクリプト追加
COPY start.sh /start.sh
RUN chmod +x /start.sh

WORKDIR /comfyui

# エントリーポイント
CMD ["/start.sh"]

