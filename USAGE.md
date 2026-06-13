# Using Comb (hands-on)

`comb` is the command (run `npm link` once in this repo if "command not found").
Local backend = $0/query, nothing leaves your machine.

## Start clean, ingest YOUR data
    comb reset                       # wipe knowledge + loop state (keeps agents)
    comb reset --all                 # wipe everything
    comb ingest ./your-doc.md --source handbook
    comb ingest ./data.csv --source pricing
    comb ingest "https://your-wiki/page" --source wiki
    # sample files to try or template from: sample-data/
    comb calibrate --labels labels.json   # tune cite-or-refuse to your corpus

## Ask (grounded or honestly refused)
    comb run --agent builtin "your question"

## Make your own agent, then let it DO tasks
    comb new "an agent that answers HR and benefits questions"
    comb commission "<name>"                       # must pass its birth evals to run
    comb run --saved "<name>" "a question"         # answer
    comb run --saved "<name>" --act "draft a benefits summary notice"   # DO a task -> approval queue
    comb actions                                   # review what it drafted
    comb approve <id>                              # approve -> executes + delivers

## The closed loop (intent -> reality -> flag -> action)
    comb intent "Onboarding ships first feature in under 4 weeks" --kind goal
    comb ingest ./retro.md --source retro          # feed reality
    comb divergences                               # diverged / aligned / silent
    comb actions                                   # a flag becomes an approvable action

## See the receipts
    comb runs            comb trace <id>           comb runs --failed
    comb intents         comb divergences          comb budget   comb doctor
