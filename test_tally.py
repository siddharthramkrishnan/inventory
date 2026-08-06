import requests

TALLY_URL = "http://192.168.29.22:9999"

xml_request = """
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

try:
    response = requests.post(
        TALLY_URL,
        data=xml_request.encode("utf-8"),
        timeout=5
    )

    print("Status code:", response.status_code)
    print("Raw response:\n")
    print(response.text)

except requests.exceptions.ConnectionError:
    print("Could not connect — check IP/port or that Tally's server is enabled.")

except requests.exceptions.Timeout:
    print("Connection timed out.")