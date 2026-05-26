mod lexer;
mod parser;
mod translator;

pub use translator::translate;

use crate::models::{PdqlRequest, PdqlResponse};
use anyhow::Result;

/// Parse a PDQL query string and return the equivalent PostgreSQL SQL + bind params.
pub fn pdql_to_sql(req: PdqlRequest) -> Result<PdqlResponse> {
    let tokens = lexer::tokenize(&req.query)?;
    let ast = parser::parse(tokens)?;
    let (sql, params, limit) = translator::translate(ast, req.allowed_agents, req.max_limit)?;
    Ok(PdqlResponse { sql, params, limit })
}
