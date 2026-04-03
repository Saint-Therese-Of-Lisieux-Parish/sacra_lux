# Workflows

## 1. Load Readings

```mermaid
sequenceDiagram
    participant App as "App UI"
    participant Server as "server.js"
    participant Importer as "readingsImporter.js"
    participant Organizer as "organizer.js"

    App->>Server: POST /api/load-readings
    Server->>Server: copy readings into current_mass
    Server->>Importer: importReadings(current_mass)
    Importer-->>Server: title and documents
    Server->>Organizer: createDefaultOrganizer(documents)
    Server->>Organizer: buildPresentationFromOrganizer(...)
    Server->>Server: emit state:update
    Server->>Server: scheduleSave(true)
```

## 2. Update Organizer

```mermaid
sequenceDiagram
    participant App as "App UI"
    participant Server as "server.js"
    participant Organizer as "organizer.js"

    App->>Server: POST /api/organizer
    Server->>Server: normalizeOrganizerSequence()
    Server->>Server: mergeManualSlideState()
    Server->>Server: propagateInterstitialImage()
    Server->>Organizer: buildPresentationFromOrganizer(...)
    Server->>Server: reschedule timers if needed
    Server->>Server: emit state:update
```

## 3. Countdown Handling

```mermaid
sequenceDiagram
    participant Server as "server.js"
    participant Screen as "/screen"

    Server->>Server: activate countdown slide
    Server->>Server: set countdownEndsAt
    Server->>Screen: state:update
    Screen->>Screen: render countdown
    Note over Server: timer expires
    Server->>Server: clear countdownEndsAt
    Server->>Server: advance slide
    Server->>Server: resume active phase timer
    Server->>Screen: state:update
```

## 4. Remote Interstitial Hold

```mermaid
sequenceDiagram
    participant Remote as "Phone Remote"
    participant Server as "server.js"
    participant Screen as "/screen"

    Remote->>Server: screen:interstitial-hold
    Server->>Server: remember current slide + active phase timers
    Server->>Server: stop phase/countdown timers
    Server->>Server: choose preferred interstitial slide
    Server->>Screen: state:update
    Note over Screen: render interstitial override
    Remote->>Server: screen:interstitial-hold
    Server->>Server: clear hold state
    Server->>Server: restore previous slide
    Server->>Server: restart timing as a fresh selection
    Server->>Screen: state:update
```

## 5. PIN-Gated Start

```mermaid
sequenceDiagram
    participant Phone as "Phone Browser"
    participant Server as "server.js"
    participant Security as "security.js"

    Phone->>Server: GET /start
    alt PIN configured
        Server-->>Phone: start page
        Phone->>Server: POST /api/verify-pin
        Server->>Security: verify PIN and lockout state
        alt valid
            Server->>Security: issue start token
            Server-->>Phone: redirect payload
            Phone->>Server: GET /api/start-redirect?token=...
            Server->>Security: validate token
            Server-->>Phone: redirect /remote
        else invalid or limited
            Server-->>Phone: 403 or 429
        end
    else no PIN configured
        Server-->>Phone: redirect /api/start-redirect
    end
```

## 6. Mass Asset Upload and Refresh

```mermaid
sequenceDiagram
    participant App as "App UI"
    participant Server as "server.js"

    App->>Server: POST /api/upload-mass-asset
    Server->>Server: sanitize filename and save into current_mass/assets
    Server-->>App: asset URL
    App->>Server: GET /api/mass-assets?timestamp
    Server-->>App: sorted asset list
    App->>App: refresh editor + background selectors
```

## 7. ZIP Import

```mermaid
flowchart TD
    A["POST /api/import-mass-zip"] --> B["decode base64 ZIP"]
    B --> C["read settings.json"]
    C --> D["clear current_mass"]
    D --> E["extract safe readings entries only"]
    E --> F["extract safe assets entries only"]
    F --> G["apply package to current state"]
    G --> H["emit state:update and scheduleSave(true)"]
```

Unsafe nested or traversal-style ZIP entry paths are ignored.

## 8. ZIP Export

```mermaid
flowchart TD
    A["GET /api/export-mass-zip"] --> B["saveCurrentMass()"]
    B --> C["read current_mass package"]
    C --> D["build settings payload"]
    D --> E["bundle readings and assets"]
    E --> F["stream ZIP response"]
```

## 9. AVIF Export

```mermaid
flowchart TD
    A["client emits export:avif:start"] --> B["socket rate limit check"]
    B --> C["saveCurrentMass()"]
    C --> D["convert eligible images with sharp"]
    D --> E["emit export:avif:progress"]
    E --> F["store one-time download token"]
    F --> G["emit export:avif:done"]
    G --> H["client downloads /api/export-mass-zip-avif?token=..."]
```

## 10. Archive Compression

```mermaid
flowchart TD
    A["POST /api/mass-history/:archiveId/compress"] --> B["load archive package"]
    B --> C["build AVIF-optimized ZIP"]
    C --> D["write archive-avif.zip"]
    D --> E["remove folder package"]
    E --> F["update metadata to storage=compressed"]
```

## 11. Session Restore

```mermaid
flowchart TD
    A["server starts listening"] --> B["restoreSession()"]
    B --> C{"session exists?"}
    C -->|no| D["keep defaults"]
    C -->|yes| E["restore session fields"]
    E --> F{"current_mass has readings?"}
    F -->|yes| G["import from current_mass"]
    F -->|no| H["fallback to lastReadingsFolderPath"]
    G --> I["build presentation"]
    H --> I
    I --> J["schedule start timer"]
    J --> K["emit initial state:update"]
```
