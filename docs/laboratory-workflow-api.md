# Laboratory Workflow API Contract

Base URL:
- `VITE_LAB_API_BASE_URL` (recommended)
- fallback: `/admin/api/lab`

## 1) GET `request.php`

Use:
- Queue list: `GET /admin/api/lab/request.php`
- Single request: `GET /admin/api/lab/request.php?id=1208`

Optional query params for queue:
- `search`
- `status` (`pending`, `in_progress`, `completed`)
- `category`
- `priority`
- `doctor`
- `fromDate`
- `toDate`

Response shape:
```json
{
  "ok": true,
  "data": {
    "requests": [
      {
        "request_id": 1208,
        "visit_id": "VISIT-2026-2001",
        "patient_id": "PAT-3401",
        "patient_name": "Maria Santos",
        "category": "Blood Test",
        "priority": "Normal",
        "status": "Pending",
        "requested_at": "2026-02-12T10:45:00Z",
        "requested_by": "Dr. Humour"
      }
    ]
  }
}
```

Single-request response can return either:
- `data.request` object, or
- `data` as request object directly.

## 2) POST `start_processing.php`

Request body:
```json
{
  "request_id": 1208,
  "lab_staff": "Tech Anne",
  "sample_collected": true,
  "sample_collected_at": "2026-02-12T11:02:00Z",
  "processing_started_at": "2026-02-12T11:02:00Z"
}
```

Expected behavior:
- Status: `Pending` -> `In Progress`
- Persist `processing_started_at`
- Write to `activity_logs`

## 3) POST `save_results.php`

Request body:
```json
{
  "request_id": 1208,
  "summary": "WBC: 6.4; RBC: 4.8; Hemoglobin: 14.2",
  "encoded_values": {
    "wbc": 6.4,
    "rbc": 4.8,
    "hemoglobin": 14.2
  },
  "attachment_name": "request-1208-raw.pdf",
  "finalize": true,
  "result_encoded_at": "2026-02-12T11:20:00Z"
}
```

Expected behavior:
- Save draft when `finalize = false`
- If `finalize = true`: status becomes `Result Ready`
- Persist `result_encoded_at`
- Write to `activity_logs`

## 4) POST `release_report.php`

Request body:
```json
{
  "request_id": 1208,
  "released_by": "Lab Staff",
  "released_at": "2026-02-12T11:31:00Z"
}
```

Expected behavior:
- Allowed only if status is `Result Ready`
- Status becomes `Completed`
- Persist `released_at`
- Write to `activity_logs`

## 5) GET `activity.php`

Use:
- `GET /admin/api/lab/activity.php?id=1208`

Response shape:
```json
{
  "ok": true,
  "data": {
    "logs": [
      {
        "id": 1001,
        "request_id": 1208,
        "action": "Processing Started",
        "details": "Status changed to In Progress",
        "actor": "Tech Anne",
        "created_at": "2026-02-12T11:02:00Z"
      }
    ]
  }
}
```

## Error shape

```json
{
  "ok": false,
  "message": "Human-readable error message"
}
```

## Validation rules expected by UI

- `Pending` -> only start processing
- `In Progress` -> encode/save/finalize
- `Result Ready` -> release report
- `Completed` -> view/print/download only
- Release blocked if encoded result is incomplete
