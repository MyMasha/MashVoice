use mashvoice_core::{
    hardware::HardwareController,
    security::SecurityEngine,
    store::MashStore,
    updater::{GITHUB_ORG, GITHUB_REPO},
};
use mashvoice_server::build_router;
use std::{net::SocketAddr, path::PathBuf};

fn resolve_arg(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1).cloned())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let data_dir = std::env::var("MASHVOICE_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| cwd.join("data"));

    // Built-in Rust CLI command: `cargo run -p mashvoice-server -- mint-token --label "Ami" --days 365`
    if args.get(1).map(|s| s.as_str()) == Some("mint-token") {
        let label = resolve_arg(&args, "--label").unwrap_or_else(|| "Token Invitation P2P".into());
        let tier = resolve_arg(&args, "--tier").unwrap_or_else(|| "MEMBER".into());
        let days = resolve_arg(&args, "--days")
            .and_then(|d| d.parse::<u64>().ok())
            .unwrap_or(365);
        let bound_user = resolve_arg(&args, "--user");

        let sec = SecurityEngine::new(&data_dir);
        let store = MashStore::new(&data_dir, &sec);
        let minted = sec.mint_connection_token(None, &label, &tier, days, bound_user.clone());
        store.register_issued_token(&minted);

        println!("\n============================================================");
        println!("  MASHVOICE SINGULARITY (RUST) — TOKEN DE CONNEXION GÉNÉRÉ");
        println!("============================================================");
        println!("  Libellé      : {}", label);
        println!("  Niveau       : {}", tier);
        println!("  Validité     : {} jours", days);
        if let Some(u) = bound_user {
            println!("  Compte lié   : {}", u);
        }
        println!("  Token requis :\n\n  {}\n", minted.token);
        println!("============================================================\n");
        return;
    }

    // Dynamically size Tokio worker threads according to user's HardwareConfig!
    let hw = HardwareController::new(&data_dir);
    let cfg = hw.get_config();
    let workers = cfg.cpu_threads.clamp(1, 32);

    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(workers)
        .enable_all()
        .thread_name("mashvoice-p2p")
        .build()
        .expect("Failed to initialize MashVoice Tokio runtime");

    rt.block_on(async move {
        let port: u16 = std::env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3080);

        let dist_dir = cwd.join("dist");
        let (router, _state) = build_router(&data_dir, Some(dist_dir));

        let addr = SocketAddr::from(([0, 0, 0, 0], port));
        let listener = tokio::net::TcpListener::bind(addr)
            .await
            .expect("Failed to bind MashVoice Rust server port");

        println!(
            "[MashVoice Singularity 4.1 • Rust] Serveur P2P & Gatekeeper actif sur http://localhost:{} ({} threads Tokio)",
            port, workers
        );
        println!(
            "[Auto-Updater GitHub] Cible : {}/{} (Read-Only 365j)",
            GITHUB_ORG, GITHUB_REPO
        );

        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .expect("MashVoice Rust server error");
    });
}
