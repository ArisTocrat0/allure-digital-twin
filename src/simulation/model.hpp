#pragma once
#include "../../third_party/json.hpp"
#include <algorithm>
#include <array>
#include <chrono>
#include <cstdint>
#include <deque>
#include <iostream>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>
using J = nlohmann::ordered_json;
namespace twin {
const std::array<std::string, 8> states = {"processing", "blocked",  "starved",
                                           "materials",  "operator", "offshift",
                                           "repair",     "horizon"};
struct Job {
  int id = 0, attempt = 0;
  bool pending = false;
};
struct Station {
  int cycle = 0, remaining = 0, downUntil = 0, state = 2;
  Job job;
  std::array<int, 8> time{};
};
struct Event {
  int at, priority, seq;
  std::string type;
  J data;
};
struct Order {
  std::string id;
  int qty, due, shipped = 0, completed = -1;
};
double random(uint32_t seed, uint32_t id, uint32_t attempt) {
  uint32_t x = seed ^ (id * 0x9e3779b1u) ^ ((attempt + 1) * 0x85ebca6bu);
  x ^= x >> 16;
  x *= 0x7feb352du;
  x ^= x >> 15;
  x *= 0x846ca68bu;
  x ^= x >> 16;
  return double(x) / 4294967296.;
}
class Model {
  J c, log = J::array(), timeline = J::array();
  std::vector<Event> events;
  size_t index = 0;
  int seq = 0;
  std::map<std::string, int> stock, received, bom, initial;
  std::vector<std::pair<int, int>> shifts;
  std::vector<Order> orders;
  std::array<Station, 3> stations;
  std::array<std::deque<Job>, 2> buffers;
  std::deque<Job> finished;
  std::array<int, 2> caps;
  int t = 0, started = 0, scrapped = 0, produced = 0, reworked = 0, shipped = 0,
      horizon, operators, demand = 0;
  uint32_t seed;
  void note(const std::string &type, const std::string &message) {
    J e = J::object();
    e["at"] = t;
    e["type"] = type;
    e["message"] = message;
    log.push_back(std::move(e));
  }
  void add(int at, std::string type, J data, int priority) {
    events.push_back({at, priority, seq++, type, data});
  }
  bool onShift() {
    for (auto [a, b] : shifts)
      if (t >= a && t < b)
        return true;
    return false;
  }
  bool hasParts() {
    for (auto [k, v] : bom)
      if (stock[k] < v)
        return false;
    return true;
  }
  void stabilize() {
    for (int loop = 0; loop < 12; loop++) {
      bool changed = false;
      for (int i = 2; i >= 0; i--) {
        auto &s = stations[i];
        if (!s.job.id || s.remaining != 0)
          continue;
        if (i == 2) {
          auto &j = s.job;
          bool fail = random(seed, j.id, j.attempt) <
                      c[j.attempt ? "reworkFail" : "qualityFail"].get<double>();
          if (fail && j.attempt == 0) {
            if (t == horizon) {
              j.pending = true;
              note("quality", "#" + std::to_string(j.id) +
                                  ": переделка требуется, но не запущена — "
                                  "горизонт завершён");
              continue;
            }
            j.attempt = 1;
            reworked++;
            s.remaining = s.cycle;
            note("quality", "#" + std::to_string(j.id) +
                                ": переделка на контроле качества");
          } else {
            if (fail) {
              scrapped++;
              note("scrap",
                   "#" + std::to_string(j.id) + ": брак после переделки");
            } else {
              finished.push_back(j);
              produced++;
              note("ready",
                   "#" + std::to_string(j.id) + ": готово, ожидает отгрузки");
            }
            s.job = {};
          }
          changed = true;
        } else if (int(buffers[i].size()) < caps[i]) {
          buffers[i].push_back(s.job);
          s.job = {};
          changed = true;
        }
      }
      if (t == horizon) {
        for (auto &s : stations)
          s.state = 7;
        break;
      }
      int free = operators;
      for (int i = 2; i >= 0; i--) {
        auto &s = stations[i];
        if (s.downUntil > t) {
          s.state = 6;
          continue;
        }
        if (!onShift()) {
          s.state = 5;
          continue;
        }
        if (s.job.id && s.remaining == 0) {
          s.state = 1;
          continue;
        }
        if (!s.job.id) {
          if (i == 0) {
            if (started >= demand + scrapped) {
              s.state = 2;
              continue;
            }
            if (!hasParts()) {
              s.state = 3;
              continue;
            }
          } else if (buffers[i - 1].empty()) {
            s.state = 2;
            continue;
          }
        }
        if (!free) {
          s.state = 4;
          continue;
        }
        free--;
        if (!s.job.id) {
          if (i == 0) {
            for (auto [k, v] : bom)
              stock[k] -= v;
            s.job = {++started, 0, false};
            note("start",
                 "#" + std::to_string(s.job.id) + ": BOM списан атомарно");
          } else {
            s.job = buffers[i - 1].front();
            buffers[i - 1].pop_front();
          }
          s.remaining = s.cycle;
          changed = true;
        }
        s.state = 0;
      }
      if (!changed)
        break;
    }
  }
  void ship() {
    for (auto &o : orders) {
      int qty = std::min(o.qty - o.shipped, int(finished.size()));
      if (!qty)
        continue;
      for (int i = 0; i < qty; i++)
        finished.pop_front();
      o.shipped += qty;
      shipped += qty;
      note("shipment", o.id + ": отгружено " + std::to_string(qty) + " шт.");
      if (o.shipped == o.qty)
        o.completed = t;
    }
  }
  void check() {
    int wip = int(buffers[0].size() + buffers[1].size()), active = 0;
    for (auto &s : stations) {
      wip += s.job.id != 0;
      active += s.state == 0;
    }
    if (started != wip + scrapped + int(finished.size()) + shipped ||
        produced != int(finished.size()) + shipped || active > operators)
      throw std::runtime_error("Vehicle/resource conservation");
    for (auto [k, v] : stock)
      if (v < 0 || v != initial[k] + received[k] - started * bom[k])
        throw std::runtime_error("Component conservation");
    for (int i = 0; i < 2; i++)
      if (int(buffers[i].size()) > caps[i])
        throw std::runtime_error("Buffer capacity");
  }
  void process() {
    size_t begin = index;
    while (index < events.size() && events[index].at == t)
      index++;
    for (size_t n = begin; n < index; n++) {
      auto &e = events[n];
      auto &d = e.data;
      if (e.type == "delivery") {
        for (auto it = d["parts"].begin(); it != d["parts"].end(); ++it) {
          stock[it.key()] += it.value().get<int>();
          received[it.key()] += it.value().get<int>();
        }
        note("delivery", "Поставка компонентов принята");
      }
      if (e.type == "failure") {
        int i = d["station"], duration = d["duration"];
        stations[i].downUntil = std::max(stations[i].downUntil, t + duration);
        note("failure", "Станция " + std::to_string(i + 1) +
                            ": поломка, ремонт " + std::to_string(duration) +
                            " с");
      }
      if (e.type == "repair") {
        int i = d["station"];
        if (stations[i].downUntil <= t)
          note("repair",
               "Станция " + std::to_string(i + 1) + ": ремонт завершён");
      }
      if (e.type == "shift")
        note("shift", d["on"].get<bool>() ? "Начало смены" : "Конец смены");
    }
    stabilize();
    for (size_t n = begin; n < index; n++) {
      auto &e = events[n];
      if (e.type == "ship")
        ship();
      if (e.type == "deadline")
        for (auto &o : orders)
          if (o.id == e.data["id"])
            note("deadline", o.id + ": к сроку отгружено " +
                                 std::to_string(o.shipped) + "/" +
                                 std::to_string(o.qty));
    }
    J point = J::object();
    point["at"] = t;
    point["produced"] = produced;
    point["shipped"] = shipped;
    timeline.push_back(std::move(point));
    check();
  }
  static J jobJson(Job j) {
    if (!j.id)
      return nullptr;
    J v = {{"id", j.id}, {"attempt", j.attempt}};
    if (j.pending)
      v["pendingRework"] = true;
    return v;
  }

public:
  explicit Model(const J &input) : c(input) {
    horizon = c.at("horizon");
    operators = c.at("operators");
    seed = c.at("seed").get<uint32_t>();
    if (horizon < 1 || horizon > 604800 || operators < 1 || operators > 3)
      throw std::runtime_error("Invalid limits");
    for (auto it = c.at("stock").begin(); it != c.at("stock").end(); ++it) {
      stock[it.key()] = it.value();
      received[it.key()] = 0;
    }
    initial = stock;
    for (auto it = c.at("bom").begin(); it != c.at("bom").end(); ++it)
      bom[it.key()] = it.value();
    for (int i = 0; i < 3; i++) {
      stations[i].cycle = c.at("cycles").at(i);
      if (stations[i].cycle < 1)
        throw std::runtime_error("Invalid cycle");
    }
    for (int i = 0; i < 2; i++)
      caps[i] = c.at("bufferCaps").at(i);
    for (auto &s : c["shifts"]) {
      int a = s[0], b = s[1];
      shifts.push_back({a, b});
      add(a, "shift", {{"on", true}}, 3);
      add(b, "shift", {{"on", false}}, 3);
    }
    // Sequence matches the JS reference: deliveries, failures, shifts,
    // shipments, deadlines.
    events.clear();
    seq = 0;
    for (auto &d : c["deliveries"])
      add(d["at"], "delivery", d, 0);
    for (auto &f : c["failures"]) {
      int at = f["at"], duration = f["duration"];
      add(at, "failure", f, 1);
      add(at + duration, "repair", {{"station", f["station"]}}, 2);
    }
    for (auto [a, b] : shifts) {
      add(a, "shift", {{"on", true}}, 3);
      add(b, "shift", {{"on", false}}, 3);
    }
    int every = c["shipEvery"];
    if (every < 1)
      throw std::runtime_error("Invalid shipping");
    for (int at = every; at <= horizon; at += every)
      add(at, "ship", J::object(), 5);
    for (auto &o : c["orders"]) {
      orders.push_back({o["id"], o["qty"], o["due"]});
      demand += o["qty"].get<int>();
      add(o["due"], "deadline", {{"id", o["id"]}}, 6);
    }
    std::stable_sort(orders.begin(), orders.end(),
                     [](auto &a, auto &b) { return a.due < b.due; });
    std::sort(events.begin(), events.end(), [](auto &a, auto &b) {
      if (a.at != b.at)
        return a.at < b.at;
      if (a.priority != b.priority)
        return a.priority < b.priority;
      return a.seq < b.seq;
    });
    process();
  }
  void advance(int target) {
    if (target < t || target > horizon)
      throw std::runtime_error("Invalid target");
    while (t < target) {
      int next = target;
      if (index < events.size())
        next = std::min(next, events[index].at);
      for (auto &s : stations)
        if (s.state == 0)
          next = std::min(next, t + s.remaining);
      if (next <= t)
        throw std::runtime_error("Stalled");
      int dt = next - t;
      for (auto &s : stations) {
        s.time[s.state] += dt;
        if (s.state == 0)
          s.remaining -= dt;
      }
      t = next;
      process();
    }
  }
  J snapshot() {
    J ss = J::array(), bb = J::array(), oo = J::array();
    for (int i = 0; i < 3; i++) {
      auto &s = stations[i];
      J times = J::object(), v = J::object();
      for (int k = 0; k < 8; k++)
        times[states[k]] = s.time[k];
      v["i"] = i;
      v["cycle"] = s.cycle;
      v["remaining"] = s.remaining;
      v["downUntil"] = s.downUntil;
      v["state"] = states[s.state];
      v["job"] = jobJson(s.job);
      v["time"] = std::move(times);
      ss.push_back(std::move(v));
    }
    for (auto &b : buffers) {
      J v = J::array();
      for (auto j : b)
        v.push_back(jobJson(j));
      bb.push_back(std::move(v));
    }
    for (auto &o : orders) {
      J v = J::object();
      v["id"] = o.id;
      v["qty"] = o.qty;
      v["due"] = o.due;
      v["shipped"] = o.shipped;
      v["completedAt"] = o.completed < 0 ? J(nullptr) : J(o.completed);
      oo.push_back(std::move(v));
    }
    J r = J::object();
    r["t"] = t;
    r["started"] = started;
    r["scrapped"] = scrapped;
    r["produced"] = produced;
    r["reworked"] = reworked;
    r["shipped"] = shipped;
    r["finished"] = finished.size();
    r["stock"] = stock;
    r["received"] = received;
    r["buffers"] = std::move(bb);
    r["stations"] = std::move(ss);
    r["orders"] = std::move(oo);
    r["log"] = log;
    r["timeline"] = timeline;
    return r;
  }
};
} // namespace twin
