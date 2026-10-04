#include "model.hpp"
int main() {
  std::string line;
  while (std::getline(std::cin, line)) {
    try {
      J req = J::parse(line), config = req.at("config"), result;
      twin::validateConfig(config);
      int horizon = twin::checkedInt(config.at("horizon"), 1, 604800);
      int target = req.contains("until")
                       ? twin::checkedInt(req.at("until"), 0, horizon)
                       : horizon;
      int repeat = req.contains("repeat")
                       ? twin::checkedInt(req.at("repeat"), 1, 10000)
                       : 1;
      if (req.contains("targets")) {
        twin::arraySize(req.at("targets"), 0, 604801);
        for (const auto &value : req.at("targets"))
          twin::checkedInt(value, 0, horizon);
      }
      auto start = std::chrono::steady_clock::now();
      for (int i = 0; i < repeat; i++) {
        twin::Model m(config);
        if (req.contains("targets")) {
          for (const auto &value : req["targets"])
            m.advance(twin::checkedInt(value, 0, horizon));
        } else
          m.advance(target);
        result = m.snapshot();
      }
      double elapsed = std::chrono::duration<double, std::milli>(
                           std::chrono::steady_clock::now() - start)
                           .count();
      std::cout << J({{"snapshot", result},
                      {"elapsedMs", elapsed},
                      {"repeat", repeat}})
                       .dump()
                << std::endl;
    } catch (const std::exception &e) {
      std::cout << J({{"error", e.what()}}).dump() << std::endl;
    }
  }
}
