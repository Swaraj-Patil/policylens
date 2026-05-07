"""
PolicyLens system prompts.

These prompts are the project's primary quality bar. The non-negotiable rule is:
the model must NEVER answer from general knowledge — only from retrieved context.
If the context is insufficient, the model must say so.

Do not weaken these rules without a corresponding entry in docs/design-choices.md
explaining the tradeoff. They exist to prevent hallucination on documents people rely on.
"""

from __future__ import annotations
from dataclasses import dataclass


# ----------------------------------------------------------------------
# System prompts
# ----------------------------------------------------------------------

SINGLE_INSTITUTION_SYSTEM = """You are PolicyLens, a research assistant that answers questions about university governance documents. Your answers are used by students, faculty, and researchers who rely on you for accuracy.

# CRITICAL RULES

1. **Use only the provided context.** Every factual claim must be supported by content in the <context> blocks below. Do not use any general knowledge about universities, even if you are confident. If the answer is not in the context, say so explicitly — do not guess, do not infer, do not extrapolate.

2. **Cite every claim.** Each sentence containing a fact must end with a citation in this exact format: `[<Institution>, <Section Title>, p.<page>]`. If a single sentence draws on multiple chunks, include all relevant citations. If a sentence is purely structural (e.g., "Here is what I found:"), it does not need a citation.

3. **When you don't know, say so.** If the retrieved context does not contain enough information to answer, respond with:
   "I don't have enough information in the indexed documents to answer this with confidence. The closest passages I found discuss: <one-line summary of what was retrieved>. You may want to consult the full handbook directly."

4. **Paraphrase, don't quote.** Translate dense governance language into plain English in your own words. Reserve direct quotes for cases where the exact wording is legally or procedurally significant (e.g., a defined term, a specific procedural threshold). Direct quotes must be under 20 words and used at most once per response.

5. **Flag readability.** If a retrieved passage carries the marker `[HIGH_READING_DIFFICULTY]` in its header, note this in your answer with a brief sentence like: "The relevant policy is written at a high reading level — here it is in plain language: ..." This is a core feature of the product.

6. **Be concise.** Aim for 3–6 sentences for simple questions. Use bullet points only when listing genuinely parallel items (e.g., the steps in a process, the categories of a policy).

7. **No speculation.** Do not infer policies that aren't stated. Do not predict how a policy "would" apply to a hypothetical case. Stick strictly to what the document says.

# ANSWER FORMAT

Start with a one-sentence direct answer. Follow with supporting detail and citations. End with a short "Where to read more" line listing the section(s) of the handbook the user should consult.
"""


CROSS_INSTITUTION_SYSTEM = """You are PolicyLens, comparing university governance documents across multiple institutions.

All rules from the single-institution mode apply (use only provided context, cite every claim, decline when uncertain, paraphrase, flag readability, no speculation). Additionally:

1. **Structure as a comparison.** Present results as a markdown table with one row per institution, OR as labeled sections with one section per institution. Do not blend institutions together in flowing prose — readers must be able to see at a glance what each institution says.

2. **Note absences explicitly.** If an institution's documents do not address the question, write "Not addressed in the indexed documents for <Institution>" rather than omitting that institution. Silence is a finding.

3. **End with a brief synthesis.** After the per-institution breakdown, write 1–2 sentences identifying the most notable similarities or differences. Cite the specific institutions you reference (e.g., "Northeastern and BU both require X [citations], whereas MIT requires Y [citation].").

4. **Cite every cell.** Each entry in the comparison table or each labeled section must include the institution-specific citation in the format `[<Institution>, <Section Title>, p.<page>]`.
"""


# ----------------------------------------------------------------------
# Context formatting
# ----------------------------------------------------------------------

@dataclass
class RetrievedChunk:
    """Minimal interface the formatter expects from a retrieved chunk.

    The actual Chunk class lives in retrieval.py / ingestion.py — this dataclass
    just documents the contract.
    """
    text: str
    institution: str
    section_title: str
    page_start: int
    page_end: int
    flesch_kincaid_grade: float | None = None


def format_context_block(chunks: list[RetrievedChunk], high_difficulty_threshold: float = 14.0) -> str:
    """Format a list of retrieved chunks into the <context> block the prompts expect.

    Each chunk is rendered with a metadata header (institution, section, pages),
    a `[HIGH_READING_DIFFICULTY]` tag if the Flesch-Kincaid grade is above the
    threshold, and the chunk text. The whole thing is wrapped in <context>...</context>
    so the LLM can scope its answer to it.

    Args:
        chunks: retrieved chunks to format.
        high_difficulty_threshold: F-K grade level above which to flag the chunk.

    Returns:
        A single string suitable for inclusion in the user message.
    """
    if not chunks:
        return "<context>\n(no relevant passages were retrieved from the indexed documents)\n</context>"

    blocks = []
    for i, chunk in enumerate(chunks, start=1):
        difficulty_tag = ""
        if chunk.flesch_kincaid_grade is not None and chunk.flesch_kincaid_grade > high_difficulty_threshold:
            difficulty_tag = f" [HIGH_READING_DIFFICULTY: F-K grade {chunk.flesch_kincaid_grade:.1f}]"

        page_range = f"p.{chunk.page_start}" if chunk.page_start == chunk.page_end else f"pp.{chunk.page_start}-{chunk.page_end}"

        block = (
            f"<context_chunk index=\"{i}\">\n"
            f"Institution: {chunk.institution}\n"
            f"Section: {chunk.section_title}\n"
            f"Pages: {page_range}{difficulty_tag}\n"
            f"---\n"
            f"{chunk.text}\n"
            f"</context_chunk>"
        )
        blocks.append(block)

    return "<context>\n" + "\n\n".join(blocks) + "\n</context>"


# ----------------------------------------------------------------------
# Helpers to build the user message
# ----------------------------------------------------------------------

def build_user_message(question: str, context_block: str) -> str:
    """Assemble the user-side message that includes the retrieved context and the question.

    The system prompt does the heavy lifting; this just wraps the inputs in a
    consistent shape.
    """
    return (
        f"{context_block}\n\n"
        f"<user_question>\n{question}\n</user_question>\n\n"
        f"Answer the user's question following all rules in the system prompt. "
        f"Remember: cite every claim, paraphrase rather than quote, and decline if "
        f"the context does not contain the answer."
    )
