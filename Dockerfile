FROM runpod/worker-comfyui:5.7.1-base
WORKDIR /comfyui/custom_nodes
RUN git clone https://github.com/Kosinkadink/ComfyUI-Advanced-ControlNet && \
    git clone https://github.com/Fannovel16/comfyui_controlnet_aux
RUN pip install --no-cache-dir -r comfyui_controlnet_aux/requirements.txt
WORKDIR /comfyui
