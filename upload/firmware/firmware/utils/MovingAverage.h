#ifndef MOVING_AVERAGE_H
#define MOVING_AVERAGE_H

// ============================================================================
// MovingAverage - Template moving average filter
// Fixed-size circular buffer, no dynamic allocation
// ============================================================================

template <typename T, size_t N>
class MovingAverage {
private:
    T _buffer[N];
    size_t _index;
    size_t _count;
    T _sum;

public:
    MovingAverage() : _index(0), _count(0), _sum(0) {
        for (size_t i = 0; i < N; i++) {
            _buffer[i] = 0;
        }
    }

    // Add new value to buffer
    void add(T value) {
        if (_count < N) {
            _sum += value;
            _count++;
        } else {
            _sum -= _buffer[_index];
            _sum += value;
        }
        _buffer[_index] = value;
        _index = (_index + 1) % N;
    }

    // Get current average
    T get() const {
        if (_count == 0) return 0;
        return _sum / _count;
    }

    // Get number of samples in buffer
    size_t count() const {
        return _count;
    }

    // Check if buffer is full
    bool isFull() const {
        return _count >= N;
    }

    // Reset buffer
    void reset() {
        _index = 0;
        _count = 0;
        _sum = 0;
        for (size_t i = 0; i < N; i++) {
            _buffer[i] = 0;
        }
    }

    // Get raw sum
    T getSum() const {
        return _sum;
    }

    // Recompute _sum from buffer (call after external buffer modification)
    void resync() {
        _sum = 0;
        for (size_t i = 0; i < _count; i++) {
            _sum += _buffer[i];
        }
    }
};

#endif // MOVING_AVERAGE_H
