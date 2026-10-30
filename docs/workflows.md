# Workflows

## 1. Load Readings

```mermaid
sequenceDiagram
    participant App as "App UI"
    participant Server as "server.js"
    participant Importer as "readingsImporter.js"
    participant Organizer as "organizer.js"

    App->>Server: POST /api/import-mass-zip
    Server->>Server: write the ZIP files into current_mass
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

The body can include `organizerRevision`. When that value is present and it
is not the current revision, the server returns HTTP 409. It does not change
the Mass. The Digital Minister page then loads the current state. A body with no
`organizerRevision` still saves. A successful save adds 1 to the revision.

## 3. Countdown Handling

```mermaid
sequenceDiagram
    participant Server as "server.js"
    participant Screen as "/screen"

    Server->>Server: activate countdown slide
    Server->>Server: set countdownEndsAt
    Server->>Screen: state:update
    Screen->>Screen: render countdown
    Note over Server: _countdownTimer expires
    Server->>Server: clear countdownEndsAt
    Server->>Server: advance slide
    Server->>Server: resume active phase timer
    Server->>Screen: state:update
```

## 4. Interstitial Hold

The server handles `screen:interstitial-hold` from a control client. The current phone remote page does not send this event.

```mermaid
sequenceDiagram
    participant Remote as "Control client"
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
            Server->>Security: issue start token and control session
            Server-->>Phone: redirect payload with cookie
            Phone->>Server: GET /api/start-redirect?token=...
            Server->>Security: validate token
            Server-->>Phone: redirect /remote#start-pre-mass
            Phone->>Server: POST /api/pre-mass/start
        else invalid or limited
            Server-->>Phone: 403 or 429
        end
    else no PIN configured
        Server-->>Phone: redirect /api/start-redirect
    end
```

## 6. Control Authentication

```mermaid
sequenceDiagram
    participant Client as "Operator / Remote"
    participant Server as "server.js"
    participant Security as "security.js"

    Client->>Server: POST /api/organizer (no token)
    Server->>Security: clientMayControl(req)
    Security-->>Server: false
    Server-->>Client: 401 Unlock required
    Client->>Server: POST /api/verify-pin
    Server->>Security: noteControlUnlock(req)
    Security-->>Server: control token
    Server-->>Client: ok + sacra_lux_control cookie
    Client->>Server: POST /api/organizer (cookie)
    Server->>Security: clientMayControl(req)
    Security-->>Server: true
    Server->>Server: apply mutation
```

`POST /api/control-sessions/end` ends every control session except the
caller. Each ended socket receives `control:required` with
`The operator ended remote sessions.`
`control:lock` ends only the session of the remote that sent it.
That remote receives `This remote is locked.`
Other sessions stay valid.

## 7. Mass Asset Upload and Refresh

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

## 8. Image Slideshow Import and Play

```mermaid
sequenceDiagram
    participant App as "App UI"
    participant Server as "server.js"
    participant Organizer as "organizer.js"
    participant Screen as "/screen"

    App->>Server: POST /api/import-slideshow-images
    Server->>Server: validate count, bytes, extensions and save assets
    Server-->>App: imported image URLs
    App->>Server: POST /api/image-slideshow/preflight
    Server->>Server: hash, read metadata, flag duplicates/missing/unreadable
    Server-->>App: per-image warnings and validCount
    App->>Server: POST /api/organizer (images + duration + loop)
    Server->>Organizer: buildPresentationFromOrganizer(...)
    Server->>Server: arm _imageSlideshowTimer for total runtime
    Server->>Screen: state:update
    Screen->>Screen: crossfade images on schedule
    Screen->>Server: image-slideshow:preload-error (on failure)
    Note over Server: timer advances or loops, then resumes phase
```

## 9. Movie Playback and Fallback

```mermaid
sequenceDiagram
    participant Server as "server.js"
    participant Screen as "/screen"
    participant Guard as "movieAdvance.js"

    Server->>Screen: state:update (movie slide)
    Screen->>Screen: play video
    alt screen reports real length
        Screen->>Server: slide:video-ready { durationMs }
        Server->>Server: arm _movieTimer fallback
    end
    alt video ends
        Screen->>Server: slide:video-ended
        Server->>Guard: alreadyHandled(index, slideId)?
        Guard-->>Server: first report only
        Server->>Server: advance slide
    else fallback fires
        Note over Server: _movieTimer expires
        Server->>Server: advance slide
    end
```

## 10. ZIP Import

```mermaid
flowchart TD
    A["POST /api/import-mass-zip"] --> B["decode base64 ZIP"]
    B --> C["read mass.json or settings.json"]
    C --> D["replace current_mass via staging dir"]
    D --> E["extract safe readings entries only"]
    E --> F["extract safe media entries only"]
    F --> G["apply package to current state"]
    G --> H["emit state:update and scheduleSave(true)"]
```

Unsafe nested or traversal-style ZIP entry paths are ignored, and the previous
package stays in place until the new package is fully written.

## 11. ZIP Export

```mermaid
flowchart TD
    A["GET /api/export-mass-zip"] --> B["saveCurrentMass()"]
    B --> C["read current_mass package"]
    C --> D["build v3 mass.json"]
    D --> E["bundle readings and assets"]
    E --> F["stream ZIP response"]
```

## 12. AVIF Export

```mermaid
flowchart TD
    A["client emits export:avif:start"] --> B["socket rate limit + control check"]
    B --> C["saveCurrentMass()"]
    C --> D["convert eligible images with sharp"]
    D --> E["emit export:avif:progress"]
    E --> F["store one-time download token"]
    F --> G["emit export:avif:done"]
    G --> H["client downloads /api/export-mass-zip-avif?token=..."]
```

## 13. Archive Compression

```mermaid
flowchart TD
    A["POST /api/mass-history/:archiveId/compress"] --> B["load archive package"]
    B --> C["build AVIF ZIP and omit converted originals"]
    C --> D["validate the ZIP"]
    D --> E["write archive-avif.zip"]
    E --> F["remove folder package"]
    F --> G["update metadata to storage=compressed"]
```

If validation fails, the folder package stays in place. A converted image is stored only as the AVIF file.

## 14. New Mass from USCCB Readings

```mermaid
sequenceDiagram
    participant App as "App UI"
    participant Server as "server.js"
    participant RSS as "lectionaryRss.js"
    participant USCCB as "bible.usccb.org"

    App->>Server: POST /api/new-mass { useLectionaryRss: true }
    Server->>RSS: fetchUsccbDailyReadings()
    RSS->>USCCB: GET /readings.rss
    USCCB-->>RSS: RSS XML
    RSS-->>Server: { title, documents }
    Server->>Server: build default organizer + attach reading stems
    Server->>Server: build presentation and arm start timer
    Server->>Server: emit state:update and scheduleSave(true)
    Server-->>App: title, slideCount, lectionaryReadingsImported
```

## 15. Session Restore

```mermaid
flowchart TD
    A["server starts listening"] --> B{"current_mass/mass.json exists?"}
    B -->|no| C["reset runtime and set startupPrompt mass-library"]
    B -->|yes| D["readMassPackageDefinition()"]
    D --> E{"valid v3 document?"}
    E -->|no| C
    E -->|yes| F["apply package to state"]
    F --> G["rebuild presentation"]
    G --> H["schedule start timer"]
    H --> I["emit initial state:update"]
    C --> I
```
