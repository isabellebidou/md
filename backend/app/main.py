from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse

app = FastAPI(title="Project Management API")
index_file = Path(__file__).parent / "static" / "index.html"


@app.get("/api/hello")
def hello() -> dict[str, str]:
    return {"message": "Hello, world!"}


@app.get("/", include_in_schema=False)
def home() -> FileResponse:
    return FileResponse(index_file, media_type="text/html")
