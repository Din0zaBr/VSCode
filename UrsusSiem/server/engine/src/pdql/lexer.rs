use anyhow::{bail, Result};

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    Ident(String),
    Str(String),
    Number(f64),
    LParen,
    RParen,
    LBracket,
    RBracket,
    Comma,
    Pipe,
    Op(String), // =, !=, <, >, <=, >=
    And,
    Or,
    Not,
    Eof,
}

/// Tokenize a PDQL query string into a flat list of tokens.
pub fn tokenize(input: &str) -> Result<Vec<Token>> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        match chars[i] {
            ' ' | '\t' | '\n' | '\r' => i += 1,
            '(' => { tokens.push(Token::LParen); i += 1; }
            ')' => { tokens.push(Token::RParen); i += 1; }
            '[' => { tokens.push(Token::LBracket); i += 1; }
            ']' => { tokens.push(Token::RBracket); i += 1; }
            ',' => { tokens.push(Token::Comma); i += 1; }
            '|' => { tokens.push(Token::Pipe); i += 1; }
            '"' | '\'' => {
                let quote = chars[i];
                i += 1;
                let start = i;
                while i < chars.len() && chars[i] != quote {
                    if chars[i] == '\\' { i += 1; } // skip escaped char
                    i += 1;
                }
                if i >= chars.len() {
                    bail!("Unterminated string literal");
                }
                let s: String = chars[start..i].iter().collect();
                tokens.push(Token::Str(s.replace("\\\"", "\"").replace("\\'", "'")));
                i += 1; // skip closing quote
            }
            '<' | '>' | '!' | '=' => {
                let mut op = chars[i].to_string();
                i += 1;
                if i < chars.len() && chars[i] == '=' {
                    op.push('=');
                    i += 1;
                }
                tokens.push(Token::Op(op));
            }
            c if c.is_ascii_digit() || (c == '-' && i + 1 < chars.len() && chars[i+1].is_ascii_digit()) => {
                let start = i;
                i += 1;
                while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                    i += 1;
                }
                let num_str: String = chars[start..i].iter().collect();
                let n: f64 = num_str.parse().map_err(|_| anyhow::anyhow!("Invalid number: {}", num_str))?;
                tokens.push(Token::Number(n));
            }
            c if c.is_alphanumeric() || c == '_' || c == '.' || c == '/' => {
                let start = i;
                while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_' || chars[i] == '.' || chars[i] == '/') {
                    i += 1;
                }
                let word: String = chars[start..i].iter().collect();
                match word.to_lowercase().as_str() {
                    "and" => tokens.push(Token::And),
                    "or" => tokens.push(Token::Or),
                    "not" => tokens.push(Token::Not),
                    _ => tokens.push(Token::Ident(word)),
                }
            }
            c => bail!("Unexpected character: '{}'", c),
        }
    }

    tokens.push(Token::Eof);
    Ok(tokens)
}
