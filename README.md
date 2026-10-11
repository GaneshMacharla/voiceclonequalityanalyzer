# voice/lens

Voice clone quality analysis workspace based on the supplied PRD.

## Current MVP slice

- React + TypeScript upload workspace with drag and drop.
- Browser-side audio decoding with duration, sample rate, channel count, file size, and waveform peak previews.
- Honest report states: unsupported ML metrics remain unavailable instead of being replaced with fabricated scores.
- FastAPI contract for uploads, asynchronous analysis status, configurable scoring weights, and cleanup.

## Run the frontend

```bash
npm install
npm run dev
```

## Run the API

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The model adapters are the next integration point: ECAPA-TDNN for speaker embeddings and Whisper for transcripts. The API currently advances through the pipeline stages but deliberately does not emit model metrics until those real analyzers are wired in.