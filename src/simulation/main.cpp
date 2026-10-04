#include "model.hpp"
int main() {
  std::string line;
  while (std::getline(std::cin, line)) {
    try {
      J req = J::parse(line), config = req.at("config"), result;
      int target = req.value("until", config.at("horizon").get<int>()),
          repeat = req.value("repeat", 1);
      if (repeat < 1 || repeat > 10000)
        throw std::runtime_error("Invalid repeat");
      auto start = std::chrono::steady_clock::now();
      for (int i = 0; i < repeat; i++) {
        twin::Model m(config);
        if (req.contains("targets")) {
          for (int target : req["targets"])
            m.advance(target);
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
