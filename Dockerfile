FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Create data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 5000

ENV GSA_HOST=0.0.0.0
ENV GSA_PORT=5000

CMD ["python3", "app.py"]
