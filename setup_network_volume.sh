#!/bin/bash
set -e

# ============================================================
# RunPod Network Volume Setup Script
# 
# Usage: 
#   export AWS_ACCESS_KEY_ID=...
#   export AWS_SECRET_ACCESS_KEY=...
#   export AWS_DEFAULT_REGION=eu-cz-1
#   ./setup_network_volume.sh
# ============================================================

# Network Volume Mount Path
VOLUME_PATH="/workspace"

# S3 Bucket Info
S3_BUCKET="s3://oatf0bxc6n/"
S3_ENDPOINT="https://s3api-eu-cz-1.runpod.io"

echo "=========================================="
echo "RunPod Network Volume Setup"
echo "Volume Path: $VOLUME_PATH"
echo "=========================================="

if [ ! -d "$VOLUME_PATH" ]; then
    echo "⚠️ Warning: $VOLUME_PATH does not exist."
    echo "Creating it now (assuming we are inside the volume or it's a regular directory)..."
    mkdir -p $VOLUME_PATH
else
    echo "✅ Volume directory found."
fi

# 1. Prepare Directory Structure
echo ""
echo "[1/6] Creating directory structure..."
mkdir -p $VOLUME_PATH/models/checkpoints
mkdir -p $VOLUME_PATH/models/loras
mkdir -p $VOLUME_PATH/models/vae
mkdir -p $VOLUME_PATH/models/controlnet
mkdir -p $VOLUME_PATH/models/ipadapter
mkdir -p $VOLUME_PATH/models/clip_vision
mkdir -p $VOLUME_PATH/input
mkdir -p $VOLUME_PATH/output

echo "✅ Directories created:"
echo "   - $VOLUME_PATH/models/checkpoints"
echo "   - $VOLUME_PATH/models/loras"
echo "   - $VOLUME_PATH/models/vae"
echo "   - $VOLUME_PATH/models/controlnet"
echo "   - $VOLUME_PATH/models/ipadapter"
echo "   - $VOLUME_PATH/models/clip_vision"
echo "   - $VOLUME_PATH/input"
echo "   - $VOLUME_PATH/output"


# 2. Download Base Model (Pony V6 XL)
echo ""
echo "[2/6] Downloading Pony Diffusion V6 XL Base Model..."
cd $VOLUME_PATH/models/checkpoints

if [ -f "ponyDiffusionV6XL.safetensors" ]; then
    echo "✅ Pony V6 XL already exists. Skipping download."
else
    echo "Downloading from HuggingFace..."
    wget -c "https://huggingface.co/AstraliteHeart/pony-diffusion-v6-xl/resolve/main/v6.safetensors" \
         -O ponyDiffusionV6XL.safetensors \
         --progress=bar:force 2>&1
    echo "✅ Pony V6 XL downloaded."
fi

# 3. Download IP-Adapter Model (SDXL PLUS)
echo ""
echo "[3/6] Downloading IP-Adapter PLUS (SDXL)..."
cd $VOLUME_PATH/models/ipadapter

if [ -f "ip-adapter-plus_sdxl_vit-h.safetensors" ]; then
    echo "✅ IP-Adapter PLUS already exists. Skipping download."
else
    echo "Downloading from HuggingFace..."
    wget -c "https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors" \
         --progress=bar:force 2>&1
    echo "✅ IP-Adapter PLUS downloaded."
fi

# 4. Download CLIP Vision Model
echo ""
echo "[4/6] Downloading CLIP Vision (ViT-H)..."
cd $VOLUME_PATH/models/clip_vision

if [ -f "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors" ]; then
    echo "✅ CLIP Vision already exists. Skipping download."
else
    echo "Downloading from HuggingFace..."
    wget -c "https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors" \
         -O CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors \
         --progress=bar:force 2>&1
    echo "✅ CLIP Vision downloaded."
fi

# 5. Download ControlNet Model
echo ""
echo "[5/6] Downloading ControlNet OpenPose SDXL..."
cd $VOLUME_PATH/models/controlnet

if [ -f "controlnet-openpose-sdxl-1.0.safetensors" ]; then
    echo "✅ ControlNet OpenPose already exists. Skipping download."
else
    echo "Downloading from HuggingFace..."
    wget -c "https://huggingface.co/lllyasviel/sd_control_collection/resolve/main/controlnet-openpose-sdxl-1.0.safetensors" \
         --progress=bar:force 2>&1
    echo "✅ ControlNet OpenPose downloaded."
fi

# 4. Download LoRAs from S3
echo ""
echo "[6/6] Downloading LoRA models from S3..."
cd $VOLUME_PATH/models/loras

# Check for AWS CLI
if ! command -v aws &> /dev/null; then
    echo "AWS CLI not found. Installing..."
    curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
    unzip -q awscliv2.zip
    ./aws/install
    rm -rf aws awscliv2.zip
fi

if [ -z "$AWS_ACCESS_KEY_ID" ]; then
    echo "❌ AWS_ACCESS_KEY_ID not set. Skipping LoRA download."
    echo "Please set AWS credentials and run this step manually:"
    echo "export AWS_ACCESS_KEY_ID=..."
    echo "export AWS_SECRET_ACCESS_KEY=..."
    echo "aws s3 cp $S3_BUCKET . --recursive --endpoint-url $S3_ENDPOINT"
else
    echo "Downloading all LoRAs from $S3_BUCKET..."
    aws s3 cp $S3_BUCKET . --recursive --endpoint-url $S3_ENDPOINT
    echo "✅ LoRA download complete."
fi

echo ""
echo "=========================================="
echo "✅ Setup Complete!"
echo "=========================================="
echo "Models are ready in $VOLUME_PATH"
