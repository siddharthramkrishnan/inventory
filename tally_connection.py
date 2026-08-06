"""
tally_connection.py

Transport layer only. No business logic, no XML building, no parsing.

This wraps the existing, already-working connection from test_tally.py
(repository root) exactly as-is:
  - same URL
  - same timeout
  - same requests.post(...) call shape
  - same two exceptions anticipated (ConnectionError, Timeout)

test_tally.py itself is left untouched. This module exists so that the
same proven transport call can be reused from multiple places (the
connectivity check and the Purchase Order request) instead of being
copy-pasted, and so a caller can catch one clear exception type instead of
inspecting console output.
"""

import requests

# Reused exactly from test_tally.py — do not change without re-verifying
# against the working script.
TALLY_URL = "http://192.168.29.22:9999"
DEFAULT_TIMEOUT = 5

# The exact Company List request from test_tally.py, reused verbatim as a
# lightweight connectivity check — this is the one request already proven
# to work, so it is the correct thing to reuse for "is Tally reachable?"
# rather than inventing a new probe request.
_COMPANY_LIST_REQUEST = """
<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>EXPORT</TALLYREQUEST>
  <TYPE>COLLECTION</TYPE>
  <ID>Company List</ID>
 </HEADER>
 <BODY>
  <DESC>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="Company List" ISMODIFY="No">
      <TYPE>Company</TYPE>
      <FETCH>NAME</FETCH>
     </COLLECTION>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>
"""


class TallyConnectionError(Exception):
    """Raised for any failure to reach Tally or get a response in time.

    Wraps requests.exceptions.ConnectionError and requests.exceptions.Timeout
    — the same two failure modes test_tally.py already anticipated — behind
    one exception type so callers have a single thing to catch.
    """


def send_request(xml_payload: str, timeout: int = DEFAULT_TIMEOUT) -> str:
    """Send a raw XML request to Tally and return the raw XML response text.

    This is the exact same call shape as test_tally.py:
        requests.post(TALLY_URL, data=xml_request.encode("utf-8"), timeout=...)
    with the same two exceptions caught, re-raised as TallyConnectionError
    so a caller doesn't need to know about the requests library at all.
    """
    try:
        response = requests.post(
            TALLY_URL,
            data=xml_payload.encode("utf-8"),
            timeout=timeout,
        )
    except requests.exceptions.ConnectionError as exc:
        raise TallyConnectionError(
            "Could not connect to Tally at "
            + TALLY_URL
            + " — check the IP/port or that Tally's server is enabled."
        ) from exc
    except requests.exceptions.Timeout as exc:
        raise TallyConnectionError(
            "Connection to Tally at " + TALLY_URL + " timed out after "
            + str(timeout) + "s."
        ) from exc

    return response.text


def check_connection(timeout: int = DEFAULT_TIMEOUT) -> bool:
    """Reuses the exact working Company List request from test_tally.py as
    a connectivity check. Returns True if Tally responded at all (any XML
    body), raises TallyConnectionError if it could not be reached.
    """
    response_text = send_request(_COMPANY_LIST_REQUEST, timeout=timeout)
    return bool(response_text and "<ENVELOPE>" in response_text)
