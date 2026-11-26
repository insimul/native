// ground_seat_bench.cpp — what one traversal.groundSeating.frame call costs against the single rows it composes
// (PL.native-ground-seat-batch, ruling U115).
//
// A binding that seats N carried bodies makes, per body per frame, one traversal.groundSeating.retarget and one
// .offsetAt call (Unreal's FSeatBook::Carry); the frame row settles every body in ONE call. This times both over
// the same frames through insimulcore.h, as a binding would make them (args built as text; neither leg parses an
// answer beyond cutting the state text out of it):
//
//   singles  per frame, per body: .retarget { state, wantMm, at } then .offsetAt { state, at }, the state carried
//            as the text .retarget answered;
//   frame    per frame: .frame { bodies: [{ state, wantMm, at }, …] }, each state carried as the text the frame
//            answered for it (the single rows' text exactly, which the equality pass checks: both legs send the same
//            states).
//
// Every frame, the frame's answer must equal the single rows' answers composed byte for byte
// (`{"bodies":[{"state":S,"offsetMm":N},…]}`), as the traversal_corpus differential holds it; a difference exits 1.
// Each body's target moves every 7 frames (a settle in flight on most frames, the same target on the rest), and
// the clock advances 16 ms a frame. Each leg runs `--repeat` times over `--frames` frames after a warm-up; the
// median and the fastest run are reported in ms per frame. A wall clock is not a gate: the ctest
// ground_seat_bench_smoke runs a few frames for the equality check only.
//
// usage: insimulcore_ground_seat_bench [--bodies N] [--frames N] [--repeat N]   (defaults 10, 600, 9)

#include "insimulcore.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

namespace {

bool call(insimul_core *core, const char *method, const std::string &args, std::string &out) {
	const char *raw = insimul_core_call(core, method, args.c_str());
	if (!raw) {
		std::fprintf(stderr, "ground_seat_bench: %s failed: %s\n", method, insimul_core_last_error(core));
		return false;
	}
	out = raw;
	return true;
}

// `{"<key>":<inner>}` → inner.
bool unwrap(const std::string &answer, const std::string &key, std::string &inner) {
	const std::string head = "{\"" + key + "\":";
	if (answer.size() < head.size() + 1 || answer.compare(0, head.size(), head) != 0 || answer.back() != '}') {
		std::fprintf(stderr, "ground_seat_bench: an answer that is not {\"%s\":...}: %s\n", key.c_str(), answer.c_str());
		return false;
	}
	inner = answer.substr(head.size(), answer.size() - head.size() - 1);
	return true;
}

long long want_of(int body, int frame) { return ((body * 37 + (frame / 7) * 53) % 301) - 150; }
long long at_of(int frame) { return 1000 + 16LL * frame; }

// One leg over `frames` frames from `initial` states; `use_frame` picks the frame row. `composed` (singles leg)
// collects each frame's composed answer; the frame leg compares against it when `check` is given.
bool run(insimul_core *core, int bodies, int frames, bool use_frame, std::vector<std::string> *composed,
         const std::vector<std::string> *check, double &ms) {
	std::string initial, answer, inner;
	if (!call(core, "traversal.groundSeating.initial", "{}", answer) || !unwrap(answer, "state", initial)) return false;
	std::vector<std::string> states(bodies, initial);
	const auto t0 = std::chrono::steady_clock::now();
	for (int f = 0; f < frames; f++) {
		const std::string at = std::to_string(at_of(f));
		if (use_frame) {
			std::string args = "{\"bodies\":[";
			for (int b = 0; b < bodies; b++) {
				args += (b ? ",{\"state\":" : "{\"state\":") + states[b] + ",\"wantMm\":" + std::to_string(want_of(b, f)) + ",\"at\":" + at + "}";
			}
			args += "]}";
			if (!call(core, "traversal.groundSeating.frame", args, answer)) return false;
			if (check && answer != (*check)[f]) {
				std::fprintf(stderr, "ground_seat_bench: frame %d is not the single rows composed:\n  frame:   %s\n  singles: %s\n", f,
				             answer.c_str(), (*check)[f].c_str());
				return false;
			}
			// Carry each body's state as the frame answered it (when checked, the single rows' text exactly), as a
			// binding would: the same states the singles leg sends, frame by frame.
			std::size_t pos = 0;
			for (int b = 0; b < bodies; b++) {
				pos = answer.find("{\"state\":", pos);
				const std::size_t end = pos == std::string::npos ? pos : answer.find(",\"offsetMm\":", pos);
				if (end == std::string::npos) {
					std::fprintf(stderr, "ground_seat_bench: frame %d answered no state for body %d: %s\n", f, b, answer.c_str());
					return false;
				}
				states[b] = answer.substr(pos + 9, end - pos - 9);
				pos = end;
			}
		} else {
			std::string text = "{\"bodies\":[";
			for (int b = 0; b < bodies; b++) {
				if (!call(core, "traversal.groundSeating.retarget",
				          "{\"state\":" + states[b] + ",\"wantMm\":" + std::to_string(want_of(b, f)) + ",\"at\":" + at + "}", answer) ||
				    !unwrap(answer, "state", states[b]))
					return false;
				if (!call(core, "traversal.groundSeating.offsetAt", "{\"state\":" + states[b] + ",\"at\":" + at + "}", answer) ||
				    !unwrap(answer, "offsetMm", inner))
					return false;
				if (composed) text += (b ? ",{\"state\":" : "{\"state\":") + states[b] + ",\"offsetMm\":" + inner + "}";
			}
			if (composed) composed->push_back(text + "]}");
		}
	}
	ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count() / frames;
	return true;
}

double median(std::vector<double> v) {
	std::sort(v.begin(), v.end());
	return v.size() % 2 ? v[v.size() / 2] : (v[v.size() / 2 - 1] + v[v.size() / 2]) / 2;
}

} // namespace

int main(int argc, char **argv) {
	int bodies = 10, frames = 600, repeat = 9;
	for (int i = 1; i + 1 < argc; i += 2) {
		const std::string a = argv[i];
		const int n = std::atoi(argv[i + 1]);
		if (n <= 0) {
			std::fprintf(stderr, "ground_seat_bench: %s needs a positive count\n", a.c_str());
			return 2;
		}
		if (a == "--bodies") bodies = n;
		else if (a == "--frames") frames = n;
		else if (a == "--repeat") repeat = n;
		else {
			std::fprintf(stderr, "usage: insimulcore_ground_seat_bench [--bodies N] [--frames N] [--repeat N]\n");
			return 2;
		}
	}
	insimul_core *core = insimul_core_create();
	if (!core) {
		std::fprintf(stderr, "ground_seat_bench: insimul_core_create() failed\n");
		return 2;
	}
	// The equality pass (also the warm-up): the singles' composed answers, then the frame row held to them.
	std::vector<std::string> composed;
	double ms = 0;
	if (!run(core, bodies, frames, false, &composed, nullptr, ms) || !run(core, bodies, frames, true, nullptr, &composed, ms)) {
		insimul_core_destroy(core);
		return 1;
	}
	std::vector<double> singles, frame;
	for (int r = 0; r < repeat; r++) {
		double s = 0, f = 0;
		if (!run(core, bodies, frames, false, nullptr, nullptr, s) || !run(core, bodies, frames, true, nullptr, nullptr, f)) {
			insimul_core_destroy(core);
			return 1;
		}
		singles.push_back(s);
		frame.push_back(f);
	}
	const double sm = median(singles), fm = median(frame);
	std::printf("{\"version\":\"%s\",\"bodies\":%d,\"frames\":%d,\"repeat\":%d,\"answersIdentical\":true,"
	            "\"singles\":{\"callsPerFrame\":%d,\"msPerFrameMedian\":%.4f,\"msPerFrameMin\":%.4f},"
	            "\"frame\":{\"callsPerFrame\":1,\"msPerFrameMedian\":%.4f,\"msPerFrameMin\":%.4f},\"speedupMedian\":%.2f}\n",
	            insimul_core_version(), bodies, frames, repeat, 2 * bodies, sm, *std::min_element(singles.begin(), singles.end()), fm,
	            *std::min_element(frame.begin(), frame.end()), fm > 0 ? sm / fm : 0.0);
	insimul_core_destroy(core);
	return 0;
}
