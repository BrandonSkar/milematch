/* Airport reference data.
 * Format: IATA|Name|City|Country|Region|Lat|Lon
 * Region codes are the award-chart zones used by data/charts.js:
 *   NA=North America  CAM=Mexico/Central America/Caribbean  SA=South America
 *   EU=Europe         ME=Middle East    AF=Africa            SAS=South Asia
 *   NEA=North Asia    SEA=Southeast Asia  OC=Oceania/South Pacific
 * Add your own rows freely — the app parses this at load, nothing is compiled.
 */
window.PB = window.PB || {};

PB.AIRPORT_TABLE = `
ATL|Hartsfield-Jackson|Atlanta|US|NA|33.64|-84.43
AUS|Austin-Bergstrom|Austin|US|NA|30.20|-97.67
BNA|Nashville Intl|Nashville|US|NA|36.13|-86.68
BOS|Logan Intl|Boston|US|NA|42.36|-71.01
BWI|Baltimore/Washington|Baltimore|US|NA|39.18|-76.67
CLE|Cleveland Hopkins|Cleveland|US|NA|41.41|-81.85
CLT|Charlotte Douglas|Charlotte|US|NA|35.21|-80.94
CMH|John Glenn Columbus|Columbus|US|NA|40.00|-82.89
CVG|Cincinnati/N. Kentucky|Cincinnati|US|NA|39.05|-84.67
DAL|Dallas Love Field|Dallas|US|NA|32.85|-96.85
DCA|Reagan National|Washington|US|NA|38.85|-77.04
DEN|Denver Intl|Denver|US|NA|39.86|-104.67
DFW|Dallas/Fort Worth|Dallas|US|NA|32.90|-97.04
DTW|Detroit Metro|Detroit|US|NA|42.21|-83.35
EWR|Newark Liberty|New York|US|NA|40.69|-74.17
FLL|Fort Lauderdale|Fort Lauderdale|US|NA|26.07|-80.15
HNL|Daniel K. Inouye|Honolulu|US|NA|21.32|-157.92
HOU|William P. Hobby|Houston|US|NA|29.65|-95.28
IAD|Washington Dulles|Washington|US|NA|38.95|-77.46
IAH|George Bush Intercontinental|Houston|US|NA|29.98|-95.34
IND|Indianapolis Intl|Indianapolis|US|NA|39.72|-86.29
JFK|John F. Kennedy|New York|US|NA|40.64|-73.78
LAS|Harry Reid Intl|Las Vegas|US|NA|36.08|-115.15
LAX|Los Angeles Intl|Los Angeles|US|NA|33.94|-118.41
LGA|LaGuardia|New York|US|NA|40.78|-73.87
MCI|Kansas City Intl|Kansas City|US|NA|39.30|-94.71
MCO|Orlando Intl|Orlando|US|NA|28.43|-81.31
MDW|Chicago Midway|Chicago|US|NA|41.79|-87.75
MEM|Memphis Intl|Memphis|US|NA|35.04|-89.98
MIA|Miami Intl|Miami|US|NA|25.79|-80.29
MKE|Milwaukee Mitchell|Milwaukee|US|NA|42.95|-87.90
MSP|Minneapolis-St Paul|Minneapolis|US|NA|44.88|-93.22
MSY|Louis Armstrong|New Orleans|US|NA|29.99|-90.26
OAK|Oakland Intl|Oakland|US|NA|37.72|-122.22
OGG|Kahului|Maui|US|NA|20.90|-156.43
OKC|Will Rogers|Oklahoma City|US|NA|35.39|-97.60
OMA|Eppley Airfield|Omaha|US|NA|41.30|-95.89
ONT|Ontario Intl|Ontario|US|NA|34.06|-117.60
ORD|O'Hare Intl|Chicago|US|NA|41.98|-87.90
PDX|Portland Intl|Portland|US|NA|45.59|-122.60
PHL|Philadelphia Intl|Philadelphia|US|NA|39.87|-75.24
PHX|Sky Harbor|Phoenix|US|NA|33.43|-112.01
PIT|Pittsburgh Intl|Pittsburgh|US|NA|40.49|-80.23
RDU|Raleigh-Durham|Raleigh|US|NA|35.88|-78.79
RSW|Southwest Florida|Fort Myers|US|NA|26.54|-81.76
SAN|San Diego Intl|San Diego|US|NA|32.73|-117.19
SAT|San Antonio Intl|San Antonio|US|NA|29.53|-98.47
SEA|Seattle-Tacoma|Seattle|US|NA|47.45|-122.31
SFO|San Francisco Intl|San Francisco|US|NA|37.62|-122.38
SJC|Norman Y. Mineta|San Jose|US|NA|37.36|-121.93
SLC|Salt Lake City|Salt Lake City|US|NA|40.79|-111.98
SMF|Sacramento Intl|Sacramento|US|NA|38.70|-121.59
SNA|John Wayne|Santa Ana|US|NA|33.68|-117.87
STL|St. Louis Lambert|St. Louis|US|NA|38.75|-90.37
TPA|Tampa Intl|Tampa|US|NA|27.98|-82.53
ANC|Ted Stevens|Anchorage|US|NA|61.17|-149.99
KOA|Kona Intl|Kailua-Kona|US|NA|19.74|-156.05
LIH|Lihue|Kauai|US|NA|21.98|-159.34
BUF|Buffalo Niagara|Buffalo|US|NA|42.94|-78.73
JAX|Jacksonville Intl|Jacksonville|US|NA|30.49|-81.69
ELP|El Paso Intl|El Paso|US|NA|31.81|-106.38
TUS|Tucson Intl|Tucson|US|NA|32.12|-110.94
BOI|Boise Air Terminal|Boise|US|NA|43.56|-116.22
ABQ|Albuquerque Sunport|Albuquerque|US|NA|35.04|-106.61
RIC|Richmond Intl|Richmond|US|NA|37.51|-77.32
ORF|Norfolk Intl|Norfolk|US|NA|36.89|-76.20
GRR|Gerald R. Ford|Grand Rapids|US|NA|42.88|-85.52
PVD|T.F. Green|Providence|US|NA|41.72|-71.43
BDL|Bradley Intl|Hartford|US|NA|41.94|-72.68
ALB|Albany Intl|Albany|US|NA|42.75|-73.80
SYR|Syracuse Hancock|Syracuse|US|NA|43.11|-76.11
ROC|Greater Rochester|Rochester|US|NA|43.12|-77.67
GSO|Piedmont Triad|Greensboro|US|NA|36.10|-79.94
CHS|Charleston Intl|Charleston|US|NA|32.90|-80.04
SAV|Savannah/Hilton Head|Savannah|US|NA|32.13|-81.20
MYR|Myrtle Beach|Myrtle Beach|US|NA|33.68|-78.93
PBI|Palm Beach Intl|West Palm Beach|US|NA|26.68|-80.10
RNO|Reno-Tahoe|Reno|US|NA|39.50|-119.77
FAT|Fresno Yosemite|Fresno|US|NA|36.78|-119.72
PSP|Palm Springs|Palm Springs|US|NA|33.83|-116.51
GEG|Spokane Intl|Spokane|US|NA|47.62|-117.53
TUL|Tulsa Intl|Tulsa|US|NA|36.20|-95.89
LIT|Clinton National|Little Rock|US|NA|34.73|-92.22
DSM|Des Moines Intl|Des Moines|US|NA|41.53|-93.66
ICT|Wichita Eisenhower|Wichita|US|NA|37.65|-97.43
YYZ|Toronto Pearson|Toronto|CA|NA|43.68|-79.63
YVR|Vancouver Intl|Vancouver|CA|NA|49.19|-123.18
YUL|Montreal-Trudeau|Montreal|CA|NA|45.47|-73.74
YYC|Calgary Intl|Calgary|CA|NA|51.11|-114.02
YOW|Ottawa Macdonald-Cartier|Ottawa|CA|NA|45.32|-75.67
YEG|Edmonton Intl|Edmonton|CA|NA|53.31|-113.58
YHZ|Halifax Stanfield|Halifax|CA|NA|44.88|-63.51
YWG|Winnipeg Richardson|Winnipeg|CA|NA|49.91|-97.24
MEX|Benito Juarez|Mexico City|MX|CAM|19.44|-99.07
CUN|Cancun Intl|Cancun|MX|CAM|21.04|-86.87
GDL|Guadalajara Intl|Guadalajara|MX|CAM|20.52|-103.31
MTY|Monterrey Intl|Monterrey|MX|CAM|25.78|-100.11
SJD|Los Cabos Intl|San Jose del Cabo|MX|CAM|23.15|-109.72
PVR|Puerto Vallarta|Puerto Vallarta|MX|CAM|20.68|-105.25
PTY|Tocumen Intl|Panama City|PA|CAM|9.07|-79.38
SJO|Juan Santamaria|San Jose|CR|CAM|9.99|-84.21
LIR|Guanacaste|Liberia|CR|CAM|10.59|-85.54
GUA|La Aurora|Guatemala City|GT|CAM|14.58|-90.53
SAL|El Salvador Intl|San Salvador|SV|CAM|13.44|-89.06
BZE|Philip Goldson|Belize City|BZ|CAM|17.54|-88.31
SJU|Luis Munoz Marin|San Juan|PR|CAM|18.44|-66.00
PUJ|Punta Cana|Punta Cana|DO|CAM|18.57|-68.36
SDQ|Las Americas|Santo Domingo|DO|CAM|18.43|-69.67
MBJ|Sangster Intl|Montego Bay|JM|CAM|18.50|-77.91
KIN|Norman Manley|Kingston|JM|CAM|17.94|-76.79
NAS|Lynden Pindling|Nassau|BS|CAM|25.04|-77.47
AUA|Queen Beatrix|Oranjestad|AW|CAM|12.50|-70.01
CUR|Curacao Intl|Willemstad|CW|CAM|12.19|-68.96
BGI|Grantley Adams|Bridgetown|BB|CAM|13.07|-59.49
SXM|Princess Juliana|Sint Maarten|SX|CAM|18.04|-63.11
HAV|Jose Marti|Havana|CU|CAM|22.99|-82.41
GCM|Owen Roberts|Grand Cayman|KY|CAM|19.29|-81.36
STT|Cyril E. King|St. Thomas|VI|CAM|18.34|-64.97
POS|Piarco Intl|Port of Spain|TT|CAM|10.60|-61.34
GRU|Guarulhos Intl|Sao Paulo|BR|SA|-23.43|-46.47
GIG|Galeao Intl|Rio de Janeiro|BR|SA|-22.81|-43.25
BSB|Brasilia Intl|Brasilia|BR|SA|-15.87|-47.92
CNF|Confins Intl|Belo Horizonte|BR|SA|-19.63|-43.97
FOR|Pinto Martins|Fortaleza|BR|SA|-3.78|-38.53
REC|Guararapes Intl|Recife|BR|SA|-8.13|-34.92
MAO|Eduardo Gomes|Manaus|BR|SA|-3.04|-60.05
EZE|Ministro Pistarini|Buenos Aires|AR|SA|-34.82|-58.54
SCL|Arturo Merino Benitez|Santiago|CL|SA|-33.39|-70.79
LIM|Jorge Chavez|Lima|PE|SA|-12.02|-77.11
CUZ|Alejandro Velasco|Cusco|PE|SA|-13.54|-71.94
BOG|El Dorado Intl|Bogota|CO|SA|4.70|-74.15
MDE|Jose Maria Cordova|Medellin|CO|SA|6.16|-75.42
CTG|Rafael Nunez|Cartagena|CO|SA|10.44|-75.51
UIO|Mariscal Sucre|Quito|EC|SA|-0.13|-78.36
GYE|Jose Joaquin de Olmedo|Guayaquil|EC|SA|-2.16|-79.88
GPS|Seymour|Galapagos|EC|SA|-0.45|-90.27
CCS|Simon Bolivar|Caracas|VE|SA|10.60|-66.99
MVD|Carrasco Intl|Montevideo|UY|SA|-34.84|-56.03
ASU|Silvio Pettirossi|Asuncion|PY|SA|-25.24|-57.52
LPB|El Alto Intl|La Paz|BO|SA|-16.51|-68.19
VVI|Viru Viru|Santa Cruz|BO|SA|-17.64|-63.14
LHR|Heathrow|London|GB|EU|51.47|-0.45
LGW|Gatwick|London|GB|EU|51.15|-0.19
LCY|London City|London|GB|EU|51.51|0.05
STN|Stansted|London|GB|EU|51.89|0.24
MAN|Manchester|Manchester|GB|EU|53.36|-2.27
EDI|Edinburgh|Edinburgh|GB|EU|55.95|-3.37
DUB|Dublin|Dublin|IE|EU|53.42|-6.27
CDG|Charles de Gaulle|Paris|FR|EU|49.01|2.55
ORY|Orly|Paris|FR|EU|48.73|2.37
NCE|Cote d'Azur|Nice|FR|EU|43.66|7.22
LYS|Saint-Exupery|Lyon|FR|EU|45.73|5.09
MRS|Marseille Provence|Marseille|FR|EU|43.44|5.22
AMS|Schiphol|Amsterdam|NL|EU|52.31|4.76
BRU|Brussels|Brussels|BE|EU|50.90|4.48
FRA|Frankfurt|Frankfurt|DE|EU|50.03|8.56
MUC|Munich|Munich|DE|EU|48.35|11.79
BER|Brandenburg|Berlin|DE|EU|52.36|13.51
DUS|Dusseldorf|Dusseldorf|DE|EU|51.29|6.77
HAM|Hamburg|Hamburg|DE|EU|53.63|10.01
STR|Stuttgart|Stuttgart|DE|EU|48.69|9.22
CGN|Cologne Bonn|Cologne|DE|EU|50.87|7.14
ZRH|Zurich|Zurich|CH|EU|47.46|8.55
GVA|Geneva|Geneva|CH|EU|46.24|6.11
VIE|Vienna Intl|Vienna|AT|EU|48.11|16.57
PRG|Vaclav Havel|Prague|CZ|EU|50.10|14.26
WAW|Chopin|Warsaw|PL|EU|52.17|20.97
KRK|John Paul II|Krakow|PL|EU|50.08|19.79
BUD|Ferenc Liszt|Budapest|HU|EU|47.44|19.26
OTP|Henri Coanda|Bucharest|RO|EU|44.57|26.10
SOF|Sofia|Sofia|BG|EU|42.70|23.41
ATH|Eleftherios Venizelos|Athens|GR|EU|37.94|23.95
SKG|Makedonia|Thessaloniki|GR|EU|40.52|22.97
JTR|Santorini|Santorini|GR|EU|36.40|25.48
HER|Heraklion|Crete|GR|EU|35.34|25.18
FCO|Fiumicino|Rome|IT|EU|41.80|12.25
MXP|Malpensa|Milan|IT|EU|45.63|8.72
LIN|Linate|Milan|IT|EU|45.45|9.28
VCE|Marco Polo|Venice|IT|EU|45.51|12.35
NAP|Capodichino|Naples|IT|EU|40.89|14.29
BLQ|Guglielmo Marconi|Bologna|IT|EU|44.53|11.30
FLR|Peretola|Florence|IT|EU|43.81|11.20
CTA|Fontanarossa|Catania|IT|EU|37.47|15.07
PMO|Falcone Borsellino|Palermo|IT|EU|38.18|13.10
MAD|Barajas|Madrid|ES|EU|40.47|-3.56
BCN|El Prat|Barcelona|ES|EU|41.30|2.08
AGP|Malaga-Costa del Sol|Malaga|ES|EU|36.68|-4.50
PMI|Palma de Mallorca|Palma|ES|EU|39.55|2.74
SVQ|Seville|Seville|ES|EU|37.42|-5.89
VLC|Valencia|Valencia|ES|EU|39.49|-0.48
BIO|Bilbao|Bilbao|ES|EU|43.30|-2.91
LIS|Humberto Delgado|Lisbon|PT|EU|38.77|-9.13
OPO|Francisco Sa Carneiro|Porto|PT|EU|41.24|-8.68
FAO|Faro|Faro|PT|EU|37.01|-7.97
CPH|Kastrup|Copenhagen|DK|EU|55.62|12.66
ARN|Arlanda|Stockholm|SE|EU|59.65|17.92
OSL|Gardermoen|Oslo|NO|EU|60.19|11.10
HEL|Helsinki-Vantaa|Helsinki|FI|EU|60.32|24.96
KEF|Keflavik|Reykjavik|IS|EU|63.99|-22.62
RIX|Riga Intl|Riga|LV|EU|56.92|23.97
TLL|Lennart Meri|Tallinn|EE|EU|59.41|24.83
VNO|Vilnius|Vilnius|LT|EU|54.63|25.29
ZAG|Franjo Tudman|Zagreb|HR|EU|45.74|16.07
SPU|Split|Split|HR|EU|43.54|16.30
DBV|Dubrovnik|Dubrovnik|HR|EU|42.56|18.27
LJU|Joze Pucnik|Ljubljana|SI|EU|46.22|14.46
BEG|Nikola Tesla|Belgrade|RS|EU|44.82|20.29
TIA|Tirana Intl|Tirana|AL|EU|41.41|19.72
MLA|Malta Intl|Malta|MT|EU|35.86|14.48
LCA|Larnaca|Larnaca|CY|EU|34.88|33.63
IST|Istanbul Airport|Istanbul|TR|EU|41.26|28.74
SAW|Sabiha Gokcen|Istanbul|TR|EU|40.90|29.31
AYT|Antalya|Antalya|TR|EU|36.90|30.79
ADB|Adnan Menderes|Izmir|TR|EU|38.29|27.16
DXB|Dubai Intl|Dubai|AE|ME|25.25|55.36
DWC|Al Maktoum|Dubai|AE|ME|24.90|55.16
AUH|Zayed Intl|Abu Dhabi|AE|ME|24.43|54.65
DOH|Hamad Intl|Doha|QA|ME|25.27|51.61
RUH|King Khalid|Riyadh|SA|ME|24.96|46.70
JED|King Abdulaziz|Jeddah|SA|ME|21.68|39.16
KWI|Kuwait Intl|Kuwait City|KW|ME|29.23|47.98
BAH|Bahrain Intl|Manama|BH|ME|26.27|50.63
MCT|Muscat Intl|Muscat|OM|ME|23.59|58.28
AMM|Queen Alia|Amman|JO|ME|31.72|35.99
TLV|Ben Gurion|Tel Aviv|IL|ME|32.01|34.89
BEY|Beirut Rafic Hariri|Beirut|LB|ME|33.82|35.49
CAI|Cairo Intl|Cairo|EG|AF|30.11|31.41
CMN|Mohammed V|Casablanca|MA|AF|33.37|-7.59
RAK|Marrakesh Menara|Marrakesh|MA|AF|31.61|-8.04
TUN|Carthage|Tunis|TN|AF|36.85|10.23
ALG|Houari Boumediene|Algiers|DZ|AF|36.69|3.22
JNB|O.R. Tambo|Johannesburg|ZA|AF|-26.13|28.24
CPT|Cape Town Intl|Cape Town|ZA|AF|-33.97|18.60
DUR|King Shaka|Durban|ZA|AF|-29.61|31.12
NBO|Jomo Kenyatta|Nairobi|KE|AF|-1.32|36.93
MBA|Moi Intl|Mombasa|KE|AF|-4.03|39.59
ADD|Bole Intl|Addis Ababa|ET|AF|8.98|38.80
LOS|Murtala Muhammed|Lagos|NG|AF|6.58|3.32
ABV|Nnamdi Azikiwe|Abuja|NG|AF|9.01|7.26
ACC|Kotoka Intl|Accra|GH|AF|5.61|-0.17
DKR|Blaise Diagne|Dakar|SN|AF|14.67|-17.07
SEZ|Seychelles Intl|Mahe|SC|AF|-4.67|55.52
MRU|Sir S. Ramgoolam|Mauritius|MU|AF|-20.43|57.68
DAR|Julius Nyerere|Dar es Salaam|TZ|AF|-6.87|39.20
JRO|Kilimanjaro|Arusha|TZ|AF|-3.43|37.07
ZNZ|Abeid Amani Karume|Zanzibar|TZ|AF|-6.22|39.22
EBB|Entebbe Intl|Entebbe|UG|AF|0.04|32.44
LUN|Kenneth Kaunda|Lusaka|ZM|AF|-15.33|28.45
HRE|Robert Mugabe|Harare|ZW|AF|-17.93|31.09
WDH|Hosea Kutako|Windhoek|NA|AF|-22.48|17.47
DEL|Indira Gandhi|Delhi|IN|SAS|28.57|77.10
BOM|Chhatrapati Shivaji|Mumbai|IN|SAS|19.09|72.87
BLR|Kempegowda|Bengaluru|IN|SAS|13.20|77.71
MAA|Chennai Intl|Chennai|IN|SAS|12.99|80.17
HYD|Rajiv Gandhi|Hyderabad|IN|SAS|17.24|78.43
CCU|Netaji Subhas Chandra Bose|Kolkata|IN|SAS|22.65|88.45
COK|Cochin Intl|Kochi|IN|SAS|10.15|76.39
GOI|Goa Intl|Goa|IN|SAS|15.38|73.83
AMD|Ahmedabad Intl|Ahmedabad|IN|SAS|23.08|72.63
CMB|Bandaranaike|Colombo|LK|SAS|7.18|79.88
KTM|Tribhuvan Intl|Kathmandu|NP|SAS|27.70|85.36
DAC|Hazrat Shahjalal|Dhaka|BD|SAS|23.84|90.40
KHI|Jinnah Intl|Karachi|PK|SAS|24.91|67.16
LHE|Allama Iqbal|Lahore|PK|SAS|31.52|74.40
ISB|Islamabad Intl|Islamabad|PK|SAS|33.55|72.83
MLE|Velana Intl|Male|MV|SAS|4.19|73.53
NRT|Narita Intl|Tokyo|JP|NEA|35.76|140.39
HND|Haneda|Tokyo|JP|NEA|35.55|139.78
KIX|Kansai Intl|Osaka|JP|NEA|34.43|135.24
ITM|Itami|Osaka|JP|NEA|34.79|135.44
NGO|Chubu Centrair|Nagoya|JP|NEA|34.86|136.81
CTS|New Chitose|Sapporo|JP|NEA|42.78|141.69
FUK|Fukuoka|Fukuoka|JP|NEA|33.59|130.45
OKA|Naha|Okinawa|JP|NEA|26.20|127.65
ICN|Incheon Intl|Seoul|KR|NEA|37.46|126.44
GMP|Gimpo|Seoul|KR|NEA|37.56|126.79
PUS|Gimhae Intl|Busan|KR|NEA|35.18|128.94
PEK|Capital Intl|Beijing|CN|NEA|40.08|116.58
PKX|Daxing Intl|Beijing|CN|NEA|39.51|116.41
PVG|Pudong Intl|Shanghai|CN|NEA|31.14|121.81
SHA|Hongqiao|Shanghai|CN|NEA|31.20|121.34
CAN|Baiyun Intl|Guangzhou|CN|NEA|23.39|113.30
SZX|Bao'an Intl|Shenzhen|CN|NEA|22.64|113.81
CTU|Tianfu Intl|Chengdu|CN|NEA|30.58|103.95
CKG|Jiangbei Intl|Chongqing|CN|NEA|29.72|106.64
XIY|Xianyang Intl|Xi'an|CN|NEA|34.44|108.75
HGH|Xiaoshan Intl|Hangzhou|CN|NEA|30.23|120.43
KMG|Changshui Intl|Kunming|CN|NEA|25.10|102.93
HKG|Hong Kong Intl|Hong Kong|HK|NEA|22.31|113.91
MFM|Macau Intl|Macau|MO|NEA|22.15|113.59
TPE|Taoyuan Intl|Taipei|TW|NEA|25.08|121.23
TSA|Songshan|Taipei|TW|NEA|25.07|121.55
ULN|Chinggis Khaan|Ulaanbaatar|MN|NEA|47.65|106.82
SIN|Changi|Singapore|SG|SEA|1.36|103.99
BKK|Suvarnabhumi|Bangkok|TH|SEA|13.69|100.75
DMK|Don Mueang|Bangkok|TH|SEA|13.91|100.61
HKT|Phuket Intl|Phuket|TH|SEA|8.11|98.32
CNX|Chiang Mai Intl|Chiang Mai|TH|SEA|18.77|98.96
KUL|Kuala Lumpur Intl|Kuala Lumpur|MY|SEA|2.74|101.71
PEN|Penang Intl|Penang|MY|SEA|5.30|100.28
CGK|Soekarno-Hatta|Jakarta|ID|SEA|-6.13|106.66
DPS|Ngurah Rai|Bali|ID|SEA|-8.75|115.17
SUB|Juanda Intl|Surabaya|ID|SEA|-7.38|112.79
MNL|Ninoy Aquino|Manila|PH|SEA|14.51|121.02
CEB|Mactan-Cebu|Cebu|PH|SEA|10.31|123.98
SGN|Tan Son Nhat|Ho Chi Minh City|VN|SEA|10.82|106.66
HAN|Noi Bai Intl|Hanoi|VN|SEA|21.22|105.81
DAD|Da Nang Intl|Da Nang|VN|SEA|16.04|108.20
PNH|Phnom Penh Intl|Phnom Penh|KH|SEA|11.55|104.84
REP|Siem Reap-Angkor|Siem Reap|KH|SEA|13.41|103.81
RGN|Yangon Intl|Yangon|MM|SEA|16.91|96.13
VTE|Wattay Intl|Vientiane|LA|SEA|17.99|102.56
BWN|Brunei Intl|Bandar Seri Begawan|BN|SEA|4.94|114.93
SYD|Kingsford Smith|Sydney|AU|OC|-33.95|151.18
MEL|Tullamarine|Melbourne|AU|OC|-37.67|144.84
BNE|Brisbane Intl|Brisbane|AU|OC|-27.38|153.12
PER|Perth Intl|Perth|AU|OC|-31.94|115.97
ADL|Adelaide Intl|Adelaide|AU|OC|-34.95|138.53
CNS|Cairns Intl|Cairns|AU|OC|-16.89|145.75
OOL|Gold Coast|Gold Coast|AU|OC|-28.16|153.51
AKL|Auckland Intl|Auckland|NZ|OC|-37.01|174.79
CHC|Christchurch Intl|Christchurch|NZ|OC|-43.49|172.53
WLG|Wellington Intl|Wellington|NZ|OC|-41.33|174.81
ZQN|Queenstown|Queenstown|NZ|OC|-45.02|168.74
NAN|Nadi Intl|Nadi|FJ|OC|-17.76|177.44
PPT|Faa'a Intl|Papeete|PF|OC|-17.56|-149.61
GUM|Antonio B. Won Pat|Guam|GU|OC|13.48|144.80
NOU|La Tontouta|Noumea|NC|OC|-22.01|166.21
`.trim();

PB.REGION_NAMES = {
  NA: 'North America',
  CAM: 'Mexico / Central America / Caribbean',
  SA: 'South America',
  EU: 'Europe',
  ME: 'Middle East',
  AF: 'Africa',
  SAS: 'South Asia',
  NEA: 'North Asia',
  SEA: 'Southeast Asia',
  OC: 'Oceania / South Pacific'
};
