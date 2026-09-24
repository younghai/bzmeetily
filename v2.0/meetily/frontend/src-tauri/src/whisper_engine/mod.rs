pub mod whisper_engine;
pub mod acceleration;
pub mod commands;
pub mod system_monitor;
// pub mod stderr_suppressor;

pub use whisper_engine::*;
pub use acceleration::*;
pub use commands::*;
pub use system_monitor::*;
// NOTE: parallel_processor/parallel_commands removed — the parallel path could
// never load a model (engine constructed without model discovery), was not
// referenced by the frontend, and duplicated the single-engine path.
// pub use stderr_suppressor::*;
