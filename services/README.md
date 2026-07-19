# Local audiobook converter APIs

Kora can convert ebooks to personal audiobooks using two self-hosted engines:

| Engine | Repo | API wrapper | Default port |
|--------|------|-------------|--------------|
| **VoxLibri** | https://github.com/Vasanth2005kk/VoxLibri | `services/voxlibri-api` | `7861` |
| **VocalBook** | https://github.com/ColbyStarr/vocalbook | `services/vocalbook-api` | `7862` |

## VoxLibri setup

```bash
git clone https://github.com/Vasanth2005kk/VoxLibri.git
cd VoxLibri
python3 build.py   # first-time setup (conda, models, deps)

export VOXLIBRI_HOME="$(pwd)"
export VOXLIBRI_DEVICE=cuda   # or cpu

cd /path/to/Kora/services/voxlibri-api
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 7861
```

Supported inputs: EPUB, PDF, MOBI, DOCX, TXT, and more (via Calibre).

## VocalBook setup

```bash
git clone https://github.com/ColbyStarr/vocalbook.git
cd vocalbook
./setup.sh
source .venv/bin/activate

# Add at least one RVC model under rvc_models/<name>/
# Create configs.json or let Kora create a default via the API

export VOCALBOOK_HOME="$(pwd)"

cd /path/to/Kora/services/vocalbook-api
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 7862
```

Supported inputs: PDF, TXT.

## Kora dev proxies

In development, Kora proxies:

- `/voxlibri-api` → `http://localhost:7861`
- `/vocalbook-api` → `http://localhost:7862`

Use those URLs in Settings if the browser blocks direct localhost requests (CORS).

## API surface (both wrappers)

- `GET /api/health`
- `POST /api/convert` — multipart upload
- `GET /api/jobs/{jobId}` — poll status
- `GET /api/jobs/{jobId}/download` — fetch finished audio (ZIP for VoxLibri, MP3 for VocalBook)
