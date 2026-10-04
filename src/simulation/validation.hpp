#pragma once
#include "../../third_party/json.hpp"
#include <cmath>
#include <cstdint>
#include <set>
#include <stdexcept>
using J = nlohmann::ordered_json;
namespace twin {
// Check the JSON representation before narrowing. Never call get<int>() on
// unchecked input.
inline uint64_t checkedInteger(const J &v, uint64_t min, uint64_t max) {
  if (!v.is_number_integer())
    throw std::runtime_error("Expected integer");
  if (!v.is_number_unsigned() && v.get<int64_t>() < 0)
    throw std::runtime_error("Negative integer");
  uint64_t n = v.get<uint64_t>();
  if (n < min || n > max)
    throw std::runtime_error("Integer out of supported range");
  return n;
}
inline int checkedInt(const J &v, int min, int max) {
  return static_cast<int>(checkedInteger(v, min, max));
}
inline void arraySize(const J &v, size_t min, size_t max) {
  if (!v.is_array() || v.size() < min || v.size() > max)
    throw std::runtime_error("Invalid array");
}
inline void validateConfig(const J &c) {
  if (!c.is_object())
    throw std::runtime_error("Invalid configuration");
  checkedInteger(c.at("seed"), 0, 4294967295ULL);
  checkedInt(c.at("horizon"), 1, 604800);
  checkedInt(c.at("operators"), 1, 3);
  checkedInt(c.at("shipEvery"), 1, 604800);
  arraySize(c.at("cycles"), 3, 3);
  for (const auto &v : c.at("cycles"))
    checkedInt(v, 1, 3600);
  arraySize(c.at("bufferCaps"), 2, 2);
  for (const auto &v : c.at("bufferCaps"))
    checkedInt(v, 1, 20);
  for (const auto *name : {"stock", "bom"}) {
    const auto &parts = c.at(name);
    if (!parts.is_object() || parts.size() != 3)
      throw std::runtime_error("Invalid components");
    for (const auto *key : {"body", "engine", "wheels"})
      checkedInt(parts.at(key), std::string(name) == "bom" ? 1 : 0,
                 std::string(name) == "bom" ? 100 : 10000);
  }
  arraySize(c.at("deliveries"), 0, 20);
  for (const auto &d : c.at("deliveries")) {
    checkedInt(d.at("at"), 0, 604800);
    const auto &parts = d.at("parts");
    if (!parts.is_object())
      throw std::runtime_error("Invalid delivery parts");
    for (auto it = parts.begin(); it != parts.end(); ++it) {
      if (!c.at("stock").contains(it.key()))
        throw std::runtime_error("Unknown component");
      checkedInt(it.value(), 0, 10000);
    }
  }
  arraySize(c.at("failures"), 0, 20);
  for (const auto &f : c.at("failures")) {
    checkedInt(f.at("at"), 0, 604800);
    checkedInt(f.at("station"), 0, 2);
    checkedInt(f.at("duration"), 1, 86400);
  }
  arraySize(c.at("shifts"), 0, 10);
  int end = -1;
  for (const auto &s : c.at("shifts")) {
    arraySize(s, 2, 2);
    int a = checkedInt(s.at(0), 0, 604800), b = checkedInt(s.at(1), 1, 604800);
    if (a >= b || a < end)
      throw std::runtime_error("Invalid shifts");
    end = b;
  }
  arraySize(c.at("orders"), 1, 20);
  std::set<std::string> ids;
  for (const auto &o : c.at("orders")) {
    const auto &id = o.at("id");
    if (!id.is_string() || id.get_ref<const std::string &>().empty() ||
        id.get_ref<const std::string &>().size() > 160 ||
        !ids.insert(id.get<std::string>()).second)
      throw std::runtime_error("Invalid order ID");
    checkedInt(o.at("qty"), 1, 1000);
    checkedInt(o.at("due"), 0, 604800);
  }
  for (const auto *key : {"qualityFail", "reworkFail"}) {
    const auto &p = c.at(key);
    if (!p.is_number())
      throw std::runtime_error("Invalid probability");
    double value = p.get<double>();
    if (!std::isfinite(value) || value < 0 || value > 1)
      throw std::runtime_error("Invalid probability");
  }
}
} // namespace twin
