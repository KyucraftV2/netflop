"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          background: "#141414",
          color: "#e5e5e5",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <main
          style={{
            minHeight: "100dvh",
            display: "grid",
            placeItems: "center",
            textAlign: "center",
            padding: 24,
          }}
        >
          <div>
            <p style={{ color: "#e50914", fontWeight: 900, fontSize: 40, margin: 0 }}>NETFLOP</p>
            <h1>Le service est momentanément indisponible</h1>
            <button
              type="button"
              onClick={reset}
              style={{
                minHeight: 44,
                padding: "0 20px",
                background: "#e50914",
                color: "#fff",
                border: 0,
                borderRadius: 8,
                fontWeight: 700,
              }}
            >
              Réessayer
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
