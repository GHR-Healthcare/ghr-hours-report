# GHR Hours Report API

Azure Functions API for generating and sending the Daily Hours report.

## Architecture

- **Azure Functions (Node.js/TypeScript)** - Timer triggers for scheduled emails, HTTP APIs for admin UI
- **ClearConnect API** - Source of shift/order data
- **Azure SQL Database** - Stores configuration (divisions, recruiters, goals) and cached snapshots
- **Microsoft Graph** - Sends emails via Office 365

## Setup

### 1. Prerequisites

- Node.js 18+
- Azure Functions Core Tools v4
- Azure subscription with:
  - Azure SQL Database (`hours_report`)
  - Azure Function App
  - Azure AD App Registration (for Microsoft Graph)

### 2. Database Setup

Run the `hours_report_schema_final.sql` script in your Azure SQL Database to create:
- `dbo.divisions` - Report sections (PA Nursing, Non-Acute, etc.)
- `dbo.recruiter_config` - Recruiter assignments and goals
- `dbo.included_regions` - Region filter for orders
- `dbo.daily_snapshots` - Cached hours data

### 3. Azure AD App Registration

Create an App Registration in Azure AD for Microsoft Graph email access:

1. Go to Azure Portal > Azure Active Directory > App registrations
2. New registration: "GHR Hours Report"
3. Add API permission: `Microsoft Graph > Application permissions > Mail.Send`
4. Grant admin consent
5. Create a client secret
6. Note the Tenant ID, Client ID, and Client Secret

### 4. Configuration

Copy `local.settings.json.template` to `local.settings.json` and fill in:

```json
{
  "Values": {
    "CLEARCONNECT_URL": "https://ctms.contingenttalentmanagement.com/genhc/clearConnect/2_0/index.cfm",
    "CLEARCONNECT_USERNAME": "your_clearconnect_username",
    "CLEARCONNECT_PASSWORD": "your_clearconnect_password",
    
    "SQL_SERVER": "ghrdatadb.database.windows.net",
    "SQL_DATABASE": "hours_report",
    "SQL_USER": "your_sql_user",
    "SQL_PASSWORD": "your_sql_password",
    
    "AZURE_TENANT_ID": "your_tenant_id",
    "AZURE_CLIENT_ID": "your_client_id",
    "AZURE_CLIENT_SECRET": "your_client_secret",
    
    "EMAIL_SENDER": "contracts@ghresources.com",
    "EMAIL_RECIPIENTS": "email1@domain.com,email2@domain.com"
  }
}
```

### 5. Add Recruiters to Database

```sql
-- Find user IDs from ClearConnect (or use the /api/clearconnect/users endpoint)
-- Then insert into recruiter_config:

INSERT INTO dbo.recruiter_config (user_id, user_name, division_id, weekly_goal, display_order)
VALUES 
  (123, 'Frank Bender', 1, 850, 1),    -- PA Nursing
  (124, 'Caitlin Williams', 1, 900, 2),
  (125, 'Kayla Borges', 1, 1200, 3);
```

### 6. Local Development

```bash
npm install
npm run build
npm start
```

### 7. Deploy to Azure

```bash
# Login to Azure
az login

# Deploy
func azure functionapp publish <your-function-app-name>
```

## API Endpoints

### Divisions
- `GET /api/divisions` - List all divisions
- `POST /api/divisions` - Create division
- `PUT /api/divisions/{id}` - Update division

### Recruiters
- `GET /api/recruiters` - List all recruiters
- `GET /api/recruiters/{id}` - Get recruiter by ID
- `POST /api/recruiters` - Create recruiter
- `PUT /api/recruiters/{id}` - Update recruiter
- `DELETE /api/recruiters/{id}` - Delete recruiter

### Report
- `GET /api/report` - Get report data as JSON
- `GET /api/report/html` - Get report as HTML (same format as email)

### Actions
- `POST /api/actions/calculate` - Manually trigger hours calculation
- `POST /api/actions/send-email` - Manually send report email
  - Body: `{ "includeLastWeek": false, "testEmail": "test@example.com" }`

### Utilities
- `GET /api/clearconnect/users` - List active ClearConnect users
- `GET /api/regions` - List included regions
- `GET /api/health` - Health check

## Scheduled Emails

| Schedule | Function | Description |
|----------|----------|-------------|
| Mon-Fri 8am ET | `dailyReport8am` | Daily hours report |
| Mon-Fri 12pm ET | `dailyReport12pm` | Daily hours report |
| Mon-Fri 5pm ET | `dailyReport5pm` | Daily hours report |
| Monday 8am ET | `mondayRecap` | Last week recap |

## Project Structure

```
hours-report-api/
├── src/
│   ├── functions/
│   │   ├── timerTriggers.ts    # Scheduled report functions
│   │   └── httpTriggers.ts     # REST API endpoints
│   ├── services/
│   │   ├── clearconnect.ts     # ClearConnect API client
│   │   ├── database.ts         # SQL database operations
│   │   └── email.ts            # Microsoft Graph email
│   ├── types/
│   │   └── index.ts            # TypeScript interfaces
│   ├── utils/
│   │   └── hours-calculator.ts # Hours calculation logic
│   └── index.ts                # Main entry point
├── host.json                   # Azure Functions config
├── local.settings.json.template
├── package.json
├── tsconfig.json
└── README.md
```

## Troubleshooting

### ClearConnect API Errors
- Verify credentials in environment variables
- Check that the API URL is correct for your site
- Test with `GET /api/clearconnect/users` endpoint

### Database Connection Issues
- Ensure firewall rules allow Azure Functions IP
- Verify connection string components
- Check SQL user permissions

### Email Not Sending
- Verify Azure AD app has `Mail.Send` permission with admin consent
- Check that `EMAIL_SENDER` mailbox exists and is licensed
- Test with `/api/actions/send-email` with a `testEmail`
