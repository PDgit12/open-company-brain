# Using Comb — model-free (no model required)

`comb` is the command (`npm i -g open-company-brain`, or `npm link` in this repo).
Model-free mode: keyword retrieval, your AI host does the thinking over MCP.

    export LLM_BACKEND=modelfree COMB_RETRIEVAL=keyword   # no model, no DB, no Docker needed

## Build the brain (facts + skills)
    comb reset                                  # clean slate for your data
    comb ingest ./doc.md --source handbook      # facts (file, .md/.txt/.csv/.json)
    comb ingest "https://wiki/page" --source wiki   # a link
    comb skill "Handle a refund request" \
      --body "verify order → check policy → goodwill credit ≤ $2k → else Finance" \
      --triggers "refund,return,money back"     # HOW work is done
    comb skills "customer wants money back"      # trigger-match the living map

## Query (grounded or honestly refused)
    comb run --agent builtin "what is the refund approval over $10,000?"

## The closed loop (intent → reality → candidate → action)
    comb intent "On-call acks every SEV1 within 15 minutes" --kind policy
    comb ingest ./incident-review.md --source incidents     # reality
    # Comb detects a divergence CANDIDATE (model-free keyword overlap);
    # your AI host judges it (list_divergence_candidates over MCP) and:
    comb actions                                 # the host's submitted alert
    comb approve <id>                            # approve → execute → deliver

## Connect your AI (the real product) — MCP
    Claude Desktop / Cursor config:
    { "mcpServers": { "comb": { "command": "comb", "args": ["mcp"],
      "env": { "COMB_RETRIEVAL": "keyword", "MCP_PRINCIPAL": "you",
               "MCP_SCOPES": "default-team" } } } }
    Tools: search_brain · find_skill · ingest · record_skill · record_fact ·
           submit_action · list_intents · list_divergence_candidates · query_runs

## Opt-in upgrade: semantic recall + a model (NOT required)
    export LLM_BACKEND=local      # Ollama + pgvector → vector retrieval + answers
    # or LLM_BACKEND=openai with your key. Same governance, dense retrieval.

## Receipts
    comb runs · comb trace <id> · comb intents · comb skills · comb divergences · comb doctor
