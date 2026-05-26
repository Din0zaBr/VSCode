use super::lexer::Token;
use anyhow::{bail, Result};
use serde_json::Value;

#[derive(Debug, Clone)]
pub enum Expr {
    And(Box<Expr>, Box<Expr>),
    Or(Box<Expr>, Box<Expr>),
    Not(Box<Expr>),
    Comparison { field: String, op: String, value: Value },
    In { field: String, values: Vec<Value> },
}

#[derive(Debug, Clone)]
pub struct SortItem {
    pub field: String,
    pub desc: bool,
}

#[derive(Debug, Clone)]
pub enum Command {
    Filter(Expr),
    Select(Vec<String>),
    Sort(Vec<SortItem>),
    Limit(usize),
    Group(Vec<String>),
    Aggregate(Vec<String>),
}

struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

impl Parser {
    fn peek(&self) -> &Token {
        self.tokens.get(self.pos).unwrap_or(&Token::Eof)
    }

    fn next(&mut self) -> Token {
        let t = self.tokens.get(self.pos).cloned().unwrap_or(Token::Eof);
        self.pos += 1;
        t
    }

    fn expect_lparen(&mut self) -> Result<()> {
        if self.next() != Token::LParen {
            bail!("Expected '('");
        }
        Ok(())
    }

    fn expect_rparen(&mut self) -> Result<()> {
        if self.next() != Token::RParen {
            bail!("Expected ')'");
        }
        Ok(())
    }

    fn parse_command(&mut self) -> Result<Command> {
        let Token::Ident(name) = self.next() else {
            bail!("Expected command name");
        };

        match name.to_lowercase().as_str() {
            "filter" | "where" => {
                self.expect_lparen()?;
                let expr = self.parse_expr()?;
                self.expect_rparen()?;
                Ok(Command::Filter(expr))
            }
            "select" => {
                self.expect_lparen()?;
                let cols = self.parse_ident_list()?;
                self.expect_rparen()?;
                Ok(Command::Select(cols))
            }
            "sort" => {
                self.expect_lparen()?;
                let items = self.parse_sort_items()?;
                self.expect_rparen()?;
                Ok(Command::Sort(items))
            }
            "limit" => {
                self.expect_lparen()?;
                let Token::Number(n) = self.next() else {
                    bail!("Expected number after limit(");
                };
                self.expect_rparen()?;
                Ok(Command::Limit(n as usize))
            }
            "group" => {
                self.expect_lparen()?;
                let cols = self.parse_ident_list()?;
                self.expect_rparen()?;
                Ok(Command::Group(cols))
            }
            "aggregate" => {
                self.expect_lparen()?;
                let funcs = self.parse_aggregate_list()?;
                self.expect_rparen()?;
                Ok(Command::Aggregate(funcs))
            }
            other => bail!("Unknown command: '{}'", other),
        }
    }

    fn parse_expr(&mut self) -> Result<Expr> {
        self.parse_or()
    }

    fn parse_or(&mut self) -> Result<Expr> {
        let mut left = self.parse_and()?;
        while *self.peek() == Token::Or {
            self.next();
            let right = self.parse_and()?;
            left = Expr::Or(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn parse_and(&mut self) -> Result<Expr> {
        let mut left = self.parse_unary()?;
        while *self.peek() == Token::And {
            self.next();
            let right = self.parse_unary()?;
            left = Expr::And(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn parse_unary(&mut self) -> Result<Expr> {
        if *self.peek() == Token::Not {
            self.next();
            let inner = self.parse_primary()?;
            return Ok(Expr::Not(Box::new(inner)));
        }
        self.parse_primary()
    }

    fn parse_primary(&mut self) -> Result<Expr> {
        if *self.peek() == Token::LParen {
            self.next(); // consume (
            let expr = self.parse_expr()?;
            self.expect_rparen()?;
            return Ok(expr);
        }

        let Token::Ident(field) = self.next() else {
            bail!("Expected field name in expression");
        };

        let op = match self.peek().clone() {
            Token::Op(op) => { self.next(); op }
            Token::Ident(kw) if matches!(kw.to_lowercase().as_str(),
                "contains" | "startswith" | "endswith" | "match" | "in" | "in_subnet" | "in_list") => {
                self.next();
                kw.to_lowercase()
            }
            other => bail!("Expected operator, got {:?}", other),
        };

        // IN operator: field in ["a", "b", "c"]
        if op == "in" || op == "in_list" {
            if *self.peek() == Token::LBracket {
                self.next(); // consume [
                let mut values = Vec::new();
                loop {
                    let v = self.parse_value()?;
                    values.push(v);
                    match self.peek() {
                        Token::Comma => { self.next(); }
                        Token::RBracket => { self.next(); break; }
                        other => bail!("Expected ',' or ']' in IN list, got {:?}", other),
                    }
                }
                return Ok(Expr::In { field, values });
            }
        }

        let value = self.parse_value()?;
        Ok(Expr::Comparison { field, op, value })
    }

    fn parse_value(&mut self) -> Result<Value> {
        match self.next() {
            Token::Str(s) => Ok(Value::String(s)),
            Token::Number(n) => Ok(serde_json::json!(n)),
            Token::Ident(s) => Ok(Value::String(s)),
            other => bail!("Expected value, got {:?}", other),
        }
    }

    fn parse_ident_list(&mut self) -> Result<Vec<String>> {
        let mut items = Vec::new();
        loop {
            match self.peek().clone() {
                Token::Ident(name) => { self.next(); items.push(name); }
                Token::RParen => break,
                other => bail!("Expected identifier, got {:?}", other),
            }
            if *self.peek() == Token::Comma {
                self.next();
            } else {
                break;
            }
        }
        Ok(items)
    }

    fn parse_sort_items(&mut self) -> Result<Vec<SortItem>> {
        let mut items = Vec::new();
        loop {
            let Token::Ident(field) = self.peek().clone() else { break; };
            self.next();

            let desc = match self.peek().clone() {
                Token::Ident(dir) if dir.to_lowercase() == "desc" => { self.next(); true }
                Token::Ident(dir) if dir.to_lowercase() == "asc" => { self.next(); false }
                _ => false,
            };

            items.push(SortItem { field, desc });

            if *self.peek() == Token::Comma {
                self.next();
            } else {
                break;
            }
        }
        Ok(items)
    }

    fn parse_aggregate_list(&mut self) -> Result<Vec<String>> {
        let mut funcs = Vec::new();
        loop {
            // Read function like "count()" or "count_distinct(src.ip)"
            let Token::Ident(name) = self.peek().clone() else { break; };
            self.next();

            let mut func = name.clone();
            if *self.peek() == Token::LParen {
                func.push('(');
                self.next();
                // Read inner args
                loop {
                    match self.peek().clone() {
                        Token::RParen => { self.next(); func.push(')'); break; }
                        Token::Ident(arg) => { self.next(); func.push_str(&arg); }
                        Token::Comma => { self.next(); func.push(','); }
                        Token::Op(op) => { self.next(); func.push_str(&op); }
                        Token::Number(n) => { self.next(); func.push_str(&n.to_string()); }
                        _ => break,
                    }
                }
            }
            funcs.push(func);

            if *self.peek() == Token::Comma {
                self.next();
            } else {
                break;
            }
        }
        Ok(funcs)
    }
}

/// Parse tokenized PDQL into a list of commands (pipeline stages).
pub fn parse(tokens: Vec<Token>) -> Result<Vec<Command>> {
    let mut parser = Parser { tokens, pos: 0 };
    let mut commands = Vec::new();

    while *parser.peek() != Token::Eof {
        let cmd = parser.parse_command()?;
        commands.push(cmd);

        // Consume pipe separator between commands
        if *parser.peek() == Token::Pipe {
            parser.next();
        }
    }

    Ok(commands)
}
