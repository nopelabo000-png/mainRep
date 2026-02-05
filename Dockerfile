FROM runpod/worker-comfyui:5.7.1-base

WORKDIR /comfyui/custom_nodes

# ControlNetノードをインストール
RUN git clone https://github.com/Kosinkadink/ComfyUI-Advanced-ControlNet && \
    git clone https://github.com/Fannovel16/comfyui_controlnet_aux

# 依存関係インストール
RUN pip install --no-cache-dir -r comfyui_controlnet_aux/requirements.txt

WORKDIR /comfyui
