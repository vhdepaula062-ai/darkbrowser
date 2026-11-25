//! Apply the selected IANA zone to stock Chromium targets as well as patched engines.
use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::Message;

pub async fn install(ws: &str, zone: &str) -> Result<()> {
    let (mut socket, _) = tokio_tungstenite::connect_async(ws).await?;
    socket.send(Message::Text(json!({"id":1,"method":"Target.setAutoAttach","params":{
        "autoAttach":true,"waitForDebuggerOnStart":true,"flatten":true,
        "filter":[{"type":"page"},{"type":"iframe"}]
    }}).to_string())).await?;
    let zone = zone.to_string();
    let (ready, result) = tokio::sync::oneshot::channel();
    tokio::spawn(async move {
        let mut ready = Some(ready);
        let mut next = 2u64;
        let mut pending = std::collections::HashMap::new();
        while let Some(Ok(Message::Text(text))) = socket.next().await {
            let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
            if v["method"] == "Target.attachedToTarget" {
                if let Some(sid) = v["params"]["sessionId"].as_str() {
                    pending.insert(next, sid.to_string());
                    let msg = json!({"id":next,"sessionId":sid,"method":"Emulation.setTimezoneOverride","params":{"timezoneId":zone}});
                    next += 1;
                    if socket.send(Message::Text(msg.to_string())).await.is_err() { break; }
                }
            } else if let Some(sid) = v["id"].as_u64().and_then(|id| pending.remove(&id)) {
                let error = v.get("error").map(|e| e.to_string());
                // A newly opened page remains paused until its timezone is set.
                let resume = json!({"id":0,"sessionId":sid,"method":"Runtime.runIfWaitingForDebugger","params":{}});
                if socket.send(Message::Text(resume.to_string())).await.is_err() { break; }
                if let Some(tx) = ready.take() { let _ = tx.send(error); }
            }
        }
    });
    let error = tokio::time::timeout(std::time::Duration::from_secs(15), result).await
        .context("Chromium did not acknowledge its timezone")??;
    if let Some(error) = error { anyhow::bail!("Chromium timezone override failed: {error}"); }
    Ok(())
}
