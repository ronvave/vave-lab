# Vanuatu Villages — source data

Point shapefile (UTM Zone 58S / WGS84) of 2,099 village locations supplied by Ron Vave,
reprojected to WGS84 lat/lng and inlined into `../van-cpwb-survey.html` as the
`SI_VILLAGES` JavaScript variable (variable name retained from the Solomon Islands
template — purely a label; functionally it is the Vanuatu villages dataset).

| File          | Purpose                                |
|---------------|----------------------------------------|
| villages.shp  | Point geometries (village centroids)   |
| villages.shx  | Geometry index                         |
| villages.dbf  | Attribute table (name, island, ID)     |
| villages.prj  | Projection (WGS_1984_UTM_Zone_58S)     |

Province assignment (Island → Province) is hand-coded in the build script,
following Vanuatu's standard six-province administrative geography:
Malampa, Penama, Sanma, Shefa, Tafea, Torba.
