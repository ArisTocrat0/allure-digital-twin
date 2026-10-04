# Vendored dependency

`json.hpp`: nlohmann/json 3.12.0, MIT license in `json.LICENSE.MIT`.
Source: https://github.com/nlohmann/json/tree/v3.12.0
Only the JSON adapter uses it; the simulation state uses typed C++ structures.
The compiler and developer formatters live in ignored `tools/` and are not shipped.
